module.exports = {
    fields: ['price', 'amount', 'asset'],
    validate: (tx, ts, legitUser, cb) => {
        if (!validate.integer(tx.data.price, false, false)) {
            cb(false, 'invalid tx data.price'); return
        }
        if (!validate.integer(tx.data.amount, false, false)) {
            cb(false, 'invalid tx data.amount'); return
        }
        if (!validate.string(tx.data.asset, config.assetMaxLength, config.assetMinLength, config.assetAlphabet, '')) {
            cb(false, 'invalid tx data.asset'); return
        }
        cache.findOne('accounts', { name: tx.sender }, function (err, account) {
            if (err) throw err
            if (!account || account.balance < (tx.data.amount * tx.data.price)) {
                cb(false, 'invalid tx not enough balance'); return
            }
            else cb(true)
        })
    },
    execute: (tx, ts, cb) => {
        // check sell order in market
        let amount = tx.data.amount;
        let query = { $and: [{ amount: { $gte: 1 } }, { price: { $lte: tx.data.price } }, { asset: tx.data.asset, type: "sell" }] }
        let sort = { price: 1, created: 1 }
        cache.updateOne('accounts',
            { name: tx.sender },
            { $inc: { balance: - (amount * tx.data.price) } },
            function () {
                cache.find('market', query, sort, function (err, orders) {
                    for (let i = 0; i < orders.length && amount > 0; i++) {
                        let order = orders[i];
                        //process the deal if existent order amount is bigger
                        if (order.amount >= amount) {
                            order.amount -= amount;
                            //add asset to buyer
                            cache.findOne('accounts', { name: tx.sender }, function (err, account) {
                                var assets = account.assets || {};
                                if (assets[tx.data.asset]) assets[tx.data.asset] += amount
                                else assets[tx.data.asset] = amount
                                cache.updateOne('accounts',
                                    { name: tx.sender },
                                    { $set: { assets: assets } },
                                    function () {
                                        //increase seller balance
                                        cache.updateOne('accounts',
                                            { name: order.name },
                                            { $inc: { balance: + (amount * order.price) } },
                                            function () {
                                                amount = 0;
                                                //check if the order should be removed or still have amount left in and return
                                                if (order.amount > 0) cache.updateOne('market', { _id: order._id }, { $set: order }, function () { });
                                                else cache.deleteOne('market', order, function () { });
                                                return
                                            })
                                    })

                            })

                        }
                        else {
                            //add asset to buyer
                            cache.findOne('accounts', { name: tx.sender }, function (err, account) {
                                var assets = account.assets || {};
                                if (assets[tx.data.asset]) assets[tx.data.asset] += amount
                                else assets[tx.data.asset] = amount
                                cache.updateOne('accounts',
                                    { name: tx.sender },
                                    { $set: { assets: assets } },
                                    function () {
                                        //increase seller balance
                                        cache.updateOne('accounts',
                                            { name: order.name },
                                            { $inc: { balance: + (amount * tx.data.price) } },
                                            function () {
                                                //remove the order
                                                amount -= order.amount;
                                                cache.deleteOne('market', order, function () { });
                                            })
                                    })
                            })
                        }
                    }
                    //if no order or couldnt spend all let open a new order
                    if (amount > 0) {
                        var newOrder = { name: tx.sender, amount: amount, price: tx.data.price, type: "buy", asset: tx.data.asset, created: ts }
                        cache.insertOne('market', newOrder, function () {
                            cb(true)
                        });
                    }
                    else cb(true)
                })
            })
    }
}