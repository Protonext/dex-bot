// Interactions with the DEX contract, via RPC
import { JsonRpc, Api, JsSignatureProvider } from '@proton/js';
import { BigNumber } from 'bignumber.js';
import { FILLTYPES, ORDERSIDES, ORDERTYPES } from './core/constants';
import * as dexapi from './dexapi';
import { getConfig, getLogger, getUsername } from './utils';
const logger = getLogger();
const config = getConfig();
const { endpoints, privateKey, privateKeyPermission } = config.rpc;
const username = getUsername();
let signatureProvider = process.env.npm_lifecycle_event === 'test' ? undefined : new JsSignatureProvider([privateKey]);
let actions = [];
// Initialize
const rpc = new JsonRpc(endpoints);
const api = new Api({
    rpc,
    signatureProvider
});
const apiTransact = (actions) => api.transact({ actions }, {
    blocksBehind: 300,
    expireSeconds: 3000,
});
const authorization = [{
        actor: username,
        permission: privateKeyPermission,
    }];
/**
 * Given a list of on-chain actions, apply authorization and send
 */
const transact = async (actions) => {
    // apply authorization to each action
    const authorization = [{
            actor: username,
            permission: privateKeyPermission,
        }];
    const authorizedActions = actions.map((action) => ({ ...action, authorization }));
    const maxRetries = 3;
    let attempts = 0;
    while (attempts < maxRetries) {
        try {
            await apiTransact(authorizedActions);
            break;
        }
        catch {
            attempts++;
            if (attempts >= maxRetries) {
                logger.error(`Failed after ${maxRetries} attempts`);
                throw Error;
            }
            logger.info(`Retrying RPC connection`);
        }
    }
};
/**
 * Place a buy or sell limit order. Quantity and price are string values to
 * avoid loss of precision when placing order
 */
export const prepareLimitOrder = async (marketSymbol, orderSide, quantity, price) => {
    const market = dexapi.getMarketBySymbol(marketSymbol);
    if (!market) {
        throw new Error(`No market found by symbol ${marketSymbol}`);
    }
    const askToken = market.ask_token;
    const bidToken = market.bid_token;
    const bnQuantity = new BigNumber(quantity);
    const quantityText = orderSide === ORDERSIDES.SELL
        ? `${bnQuantity.toFixed(bidToken.precision)} ${bidToken.code}`
        : `${bnQuantity.toFixed(askToken.precision)} ${askToken.code}`;
    const orderSideText = orderSide === ORDERSIDES.SELL ? 'sell' : 'buy';
    logger.info(`Placing ${orderSideText} order for ${quantityText} at ${price}`);
    const quantityNormalized = orderSide === ORDERSIDES.SELL
        ? (bnQuantity.times(bidToken.multiplier)).toString()
        : (bnQuantity.times(askToken.multiplier)).toString();
    const cPrice = new BigNumber(price);
    const priceNormalized = cPrice.multipliedBy(askToken.multiplier);
    actions.push({
        account: orderSide === ORDERSIDES.SELL ? bidToken.contract : askToken.contract,
        name: 'transfer',
        data: {
            from: username,
            to: 'dex',
            quantity: quantityText,
            memo: '',
        },
        authorization,
    }, {
        account: 'dex',
        name: 'placeorder',
        data: {
            market_id: market.market_id,
            account: username,
            order_type: ORDERTYPES.LIMIT,
            order_side: orderSide,
            quantity: quantityNormalized,
            price: priceNormalized,
            bid_symbol: {
                sym: `${bidToken.precision},${bidToken.code}`,
                contract: bidToken.contract,
            },
            ask_symbol: {
                sym: `${askToken.precision},${askToken.code}`,
                contract: askToken.contract,
            },
            trigger_price: 0,
            fill_type: FILLTYPES.GTC,
            referrer: '',
        },
        authorization,
    });
};
export const submitOrders = async () => {
    actions.push({
        account: 'dex',
        name: 'process',
        data: {
            q_size: 60,
            show_error_msg: 0,
        },
        authorization,
    }, {
        account: 'dex',
        name: "withdrawall",
        data: {
            account: username,
        },
        authorization,
    });
    const response = await apiTransact(actions);
    actions = [];
};
export const submitProcessAction = async () => {
    const processAction = [({
            account: 'dex',
            name: 'process',
            data: {
                q_size: 100,
                show_error_msg: 0,
            },
            authorization,
        })];
    const response = apiTransact(processAction);
};
const createCancelAction = (orderId) => ({
    account: 'dex',
    name: 'cancelorder',
    data: {
        account: username,
        order_id: orderId,
    },
    authorization,
});
const withdrawAction = () => ({
    account: 'dex',
    name: "withdrawall",
    data: {
        account: username,
    },
    authorization,
});
/**
 * Cancel a single order
 */
export const cancelOrder = async (orderId) => {
    logger.info(`Canceling order with id: ${orderId}`);
    const response = await transact([createCancelAction(orderId)]);
    return response;
};
/**
 * Cancel all orders for the current account
 */
export const cancelAllOrders = async () => {
    try {
        let cancelList = [];
        let i = 0;
        while (true) {
            const ordersList = await dexapi.fetchOpenOrders(username, 150, 150 * i);
            if (!ordersList.length)
                break;
            cancelList.push(...ordersList);
            i++;
        }
        if (!cancelList.length) {
            console.log(`No orders to cancel`);
            return;
        }
        console.log(`Cancelling all (${cancelList.length}) orders`);
        const actions = cancelList.map((order) => createCancelAction(order.order_id));
        const response = await transact(actions);
        return response;
    }
    catch (e) {
        console.log('cancel orders error', e);
        return undefined;
    }
};
/**
 * Get the current swaps available on-chain
 */
export const getSwaps = async () => {
    const rows = await api.rpc.get_table_rows({
        json: true,
        code: "proton.swaps",
        scope: "proton.swaps",
        table: "pools",
        lower_bound: "",
        upper_bound: "",
        index_position: 1,
        key_type: "i64",
        limit: -1,
        reverse: false,
        show_payer: false
    });
    if (rows.rows) {
        logger.info(`Fetched ${rows.rows.length} swap pools from proton.swaps`);
        const returnObj = {};
        rows.rows.forEach((r) => {
            let cleaned_symbol = r.lt_symbol.split(",")[1];
            returnObj[cleaned_symbol] = r;
        });
        return returnObj;
    }
    return {};
};
export const submitSwapRequest = async (sendAmount, sendToken, sendContract, pairSymbol) => {
    // Create a random number for the memo
    const randomNumber = Math.floor(Math.random() * 10000000);
    const action = {
        account: sendContract,
        name: 'transfer',
        authorization,
        data: {
            from: username,
            to: 'proton.swaps',
            quantity: sendAmount + ' ' + sendToken,
            memo: pairSymbol + ',' + randomNumber,
        }
    };
    const response = await transact([action]);
    return response;
};
//# sourceMappingURL=dexrpc.js.map