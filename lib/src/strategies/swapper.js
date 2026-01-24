// grid bot strategy
import { BigNumber as BN } from 'bignumber.js';
import { ORDERSIDES } from '../core/constants';
import { configValueToFloat, getConfig, getLogger, getUsername } from '../utils';
import { TradingStrategyBase } from './base';
import { fetchTokenBalance } from '../dexapi';
import { getSwaps, submitSwapRequest } from '../dexrpc';
import fs from "fs";
const logFileName = './gridbot-logs-' + getUsername() + '.txt';
const logger = getLogger();
const config = getConfig();
function logItem(item, label) {
    if (typeof item === 'object') {
        item = JSON.stringify(item, null, 2);
    }
    if (label) {
        item = `${label}: ${item}`;
    }
    fs.appendFileSync(logFileName, item + '\n\n');
}
/**
 * Grid Trading Bot Strategy
 * Grid Trading Bots are programs that allow users to automatically buy low and sell high within a pre-set price range.
 * The number of orders is determined by config values like limits, gridLevels, refer config/default.json
 */
export class SwapBotStrategy extends TradingStrategyBase {
    pairs = [];
    swapsInfo = {};
    async initialize(options) {
        if (options) {
            this.pairs = this.parseEachPairConfig(options.pairs);
        }
    }
    async trade() {
        //refresh the swaps info
        this.swapsInfo = await this.getRefreshedSwapsInfo();
        for (var i = 0; i < this.pairs.length; i++) {
            try {
                console.log("Checking for coin balances: ", this.pairs[i].symbol);
                const swapSymbol = this.pairs[i].symbol;
                const swapDetails = this.swapsInfo[swapSymbol];
                if (!swapDetails) {
                    console.log(`Swap details not found for symbol ${swapSymbol}`);
                    continue;
                }
                const configQuote = this.pairs[i].quote.toUpperCase();
                const configBase = this.pairs[i].base.toUpperCase();
                // Fetch Details From Swap Info
                // We need to determine the current balances of quote and base in the pools
                const quoteInPool = this.getTokenFromPool(swapDetails, configQuote);
                const quoteContract = this.getQuoteContractFromSymbol(swapDetails, configQuote);
                const baseInPool = this.getTokenFromPool(swapDetails, configBase);
                const baseContract = this.getQuoteContractFromSymbol(swapDetails, configBase);
                const quoteBalance = await fetchTokenBalance(getUsername(), quoteContract, configQuote);
                const baseBalance = await fetchTokenBalance(getUsername(), baseContract, configBase);
                if (!quoteInPool || !baseInPool) {
                    console.log(`Could not find one of the tokens ${configQuote} or ${configBase} in the swap pools for symbol ${swapSymbol}`);
                    continue;
                }
                // Ratio calculations to determine price ratio
                const quotePriceRatio = quoteInPool / baseInPool;
                console.log(`Swap Pool Info for ${swapSymbol} - ${configQuote} in pool: ${quoteInPool}, ${configBase} in pool: ${baseInPool}, Price Ratio (${configQuote}/${configBase}): ${quotePriceRatio}`);
                // Determine if we need to buy or sell based on thresholds
                const currentQuoteValue = this.pairs[i].quoteAmountPerSwap / quotePriceRatio;
                if (isNaN(currentQuoteValue)) {
                    console.log(`Calculated current quote value is NaN for symbol ${swapSymbol}, skipping this iteration.`);
                    continue;
                }
                // Check against buy/sell thresholds and max/min hold limits
                if (currentQuoteValue <= this.pairs[i].quoteBuyMaxThreshold) {
                    // We are possibly going to buy, test the max hold
                    if (parseFloat(quoteBalance) > this.pairs[i].quoteMaxHold) {
                        console.log(`Skipping BUY for ${swapSymbol} as quote in pool ${quoteInPool} exceeds max hold ${this.pairs[i].quoteMaxHold}`);
                        continue;
                    }
                    // Ready to buy, sending base contract
                    // Flip the quote ratio for buying
                    const invertedQuotePriceRatio = baseInPool / quoteInPool;
                    console.log(`Executing BUY for ${this.pairs[i].quoteAmountPerSwap} ${configQuote} worth ${currentQuoteValue.toFixed(6)} ${configBase} at price ratio ${invertedQuotePriceRatio.toFixed(6)}`);
                    // Place buy logic here (e.g., call dexrpc to perform the swap)
                    submitSwapRequest((this.pairs[i].quoteAmountPerSwap * invertedQuotePriceRatio).toFixed(4), configBase, baseContract, swapSymbol);
                }
                else if (currentQuoteValue >= this.pairs[i].quoteSellMinThreshold) {
                    // We are possibly going to sell, test the min hold
                    if (parseFloat(quoteBalance) < this.pairs[i].quoteMinHold) {
                        console.log(`Skipping SELL for ${swapSymbol} as quote in pool ${quoteInPool} is below min hold ${this.pairs[i].quoteMinHold}`);
                        continue;
                    }
                    // Ready to sell, sending quite contract
                    submitSwapRequest((this.pairs[i].quoteAmountPerSwap).toFixed(4), configQuote, quoteContract, swapSymbol);
                }
                else {
                    console.log(`No action required for ${swapSymbol}, current quote value ${currentQuoteValue.toFixed(6)} is within thresholds.`);
                    continue;
                }
            }
            catch (error) {
                logger.error(error.message);
            }
        }
    }
    parseEachPairConfig(pairs) {
        const result = [];
        pairs.forEach((pair, idx) => {
            if (pair.symbol === undefined) {
                throw new Error(`Market symbol option is missing for gridBot pair with index ${idx} in default.json`);
            }
            if (pair.quote === undefined ||
                pair.quoteAmountPerSwap === undefined ||
                pair.quoteMaxHold === undefined ||
                pair.quoteMinHold === undefined ||
                pair.quoteBuyMaxThreshold === undefined ||
                pair.quoteSellMinThreshold === undefined) {
                throw new Error(`Options are missing for market or gridBot pair ${pair.symbol} in default.json`);
            }
            result.push({
                symbol: pair.symbol,
                base: pair.base,
                quote: pair.quote,
                quoteAmountPerSwap: configValueToFloat(pair.quoteAmountPerSwap),
                quoteMaxHold: configValueToFloat(pair.quoteMaxHold),
                quoteMinHold: configValueToFloat(pair.quoteMinHold),
                quoteBuyMaxThreshold: configValueToFloat(pair.quoteBuyMaxThreshold),
                quoteSellMinThreshold: configValueToFloat(pair.quoteSellMinThreshold),
            });
        });
        return result;
    }
    /**
      * Given a price and total cost return a quantity value. Use precision values in the bid and ask
      * currencies, and return an adjusted total to account for losses during rounding. The adjustedTotal
      * value is used for buy orders
      */
    getQuantityAndAdjustedTotal(price, totalCost, bidPrecision, askPrecision) {
        const adjustedTotal = +new BN(totalCost).times(price).toFixed(askPrecision);
        const quantity = +new BN(adjustedTotal).dividedBy(price).toFixed(bidPrecision);
        return {
            quantity,
            adjustedTotal,
        };
    }
    async getRefreshedSwapsInfo() {
        return await getSwaps();
    }
    getTokenFromPool(swapDetails, tokenName) {
        if (swapDetails.pool1.quantity.includes(tokenName)) {
            return parseFloat(swapDetails.pool1.quantity.split(' ')[0]);
        }
        else if (swapDetails.pool2.quantity.includes(tokenName)) {
            return parseFloat(swapDetails.pool2.quantity.split(' ')[0]);
        }
        else {
            return 0;
        }
    }
    getQuoteContractFromSymbol(swapDetails, tokenName) {
        if (swapDetails.pool1.quantity.includes(tokenName)) {
            return swapDetails.pool1.contract;
        }
        else if (swapDetails.pool2.quantity.includes(tokenName)) {
            return swapDetails.pool2.contract;
        }
        else {
            return "";
        }
    }
    getHighestBid(orders) {
        const buyOrders = orders.filter((order) => order.orderSide === ORDERSIDES.BUY);
        if (buyOrders.length === 0)
            return null;
        buyOrders.sort((orderA, orderB) => {
            if (BN(orderA.price).isGreaterThan(BN(orderB.price)))
                return -1;
            if (BN(orderA.price).isLessThan(BN(orderB.price)))
                return 1;
            return 0;
        });
        const highestBid = new BN(buyOrders[0].price);
        return highestBid;
    }
    getLowestAsk(orders) {
        const sellOrders = orders.filter((order) => order.orderSide === ORDERSIDES.SELL);
        if (sellOrders.length === 0)
            return null;
        sellOrders.sort((orderA, orderB) => {
            if (BN(orderA.price).isGreaterThan(BN(orderB.price)))
                return 1;
            if (BN(orderA.price).isLessThan(BN(orderB.price)))
                return -1;
            return 0;
        });
        const lowestAsk = new BN(sellOrders[0].price);
        return lowestAsk;
    }
}
//# sourceMappingURL=swapper.js.map