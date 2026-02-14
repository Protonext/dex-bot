// swapper bot strategy
import { BigNumber as BN } from 'bignumber.js';
import { ORDERSIDES } from '../core/constants';
import { BotConfig, GridBotPair, SwapBotPair, TradeOrder, TradingStrategy } from '../interfaces';
import { configValueToFloat, configValueToInt, getConfig, getLogger, getUsername } from '../utils';
import { TradingStrategyBase } from './base';
import { fetchTokenBalance } from '../dexapi';
import { getSwaps, submitSwapRequest } from '../dexrpc';
import { events } from '../events';
import fs from "fs";

const logFileName = './gridbot-logs-' + getUsername() + '.txt';

const logger = getLogger();
const config = getConfig();

function logItem(item: string | object, label?: string) {
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
export class SwapBotStrategy extends TradingStrategyBase implements TradingStrategy {
    private pairs: SwapBotPair[] = [];
    private swapsInfo: { [key: string]: any } = {};

    async initialize(options?: BotConfig['swapper']): Promise<void> {
        if (options) {
            this.pairs = this.parseEachPairConfig(options.pairs);
        }
    }

    async trade(): Promise<void> {

        //refresh the swaps info
        this.swapsInfo = await this.getRefreshedSwapsInfo();


        for (var i = 0; i < this.pairs.length; i++) {
            try {
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
                    const invertedQuoteAmount = this.pairs[i].quoteAmountPerSwap * invertedQuotePriceRatio;

                    if (isNaN(invertedQuoteAmount) || invertedQuoteAmount >= parseFloat(baseBalance)) {
                        console.log(`Insufficient ${configBase} balance ${baseBalance} to execute BUY for ${invertedQuoteAmount.toFixed(4)} ${configBase}`);
                        continue;
                    }

                    console.log(`Executing BUY for ${this.pairs[i].quoteAmountPerSwap} ${configQuote} worth ${currentQuoteValue.toFixed(6)} ${configBase} at price ratio ${invertedQuotePriceRatio.toFixed(6)}`);

                    // Place buy logic here (e.g., call dexrpc to perform the swap)
                    submitSwapRequest(
                        (this.pairs[i].quoteAmountPerSwap * invertedQuotePriceRatio).toFixed(4),
                        configBase,
                        baseContract,
                        swapSymbol
                    );

                    // Emit swap event
                    events.swapExecuted(`BUY swap: ${this.pairs[i].quoteAmountPerSwap} ${configQuote} for ${invertedQuoteAmount.toFixed(4)} ${configBase}`, {
                        symbol: swapSymbol,
                        side: 'BUY',
                        quoteAmount: this.pairs[i].quoteAmountPerSwap,
                        quoteToken: configQuote,
                        baseAmount: invertedQuoteAmount,
                        baseToken: configBase,
                        priceRatio: invertedQuotePriceRatio,
                    });

                } else if (currentQuoteValue >= this.pairs[i].quoteSellMinThreshold) {
                    // We are possibly going to sell, test the min hold
                    if (parseFloat(quoteBalance) < this.pairs[i].quoteMinHold) {
                        console.log(`Skipping SELL for ${swapSymbol} as quote in pool ${quoteInPool} is below min hold ${this.pairs[i].quoteMinHold}`);
                        continue;
                    }

                    if (isNaN(currentQuoteValue) || this.pairs[i].quoteAmountPerSwap >= parseFloat(quoteBalance)) {
                        console.log(`Insufficient ${configQuote} balance ${quoteBalance} to execute SELL for ${this.pairs[i].quoteAmountPerSwap} ${configQuote}`);
                        continue;
                    }

                    console.log(`Executing SELL for ${this.pairs[i].quoteAmountPerSwap} ${configQuote} worth ${currentQuoteValue.toFixed(6)} ${configBase} at price ratio ${quotePriceRatio.toFixed(6)}`);
                    // Ready to sell, sending quote contract
                    submitSwapRequest(
                        (this.pairs[i].quoteAmountPerSwap).toFixed(4),
                        configQuote,
                        quoteContract,
                        swapSymbol
                    );

                    // Emit swap event
                    events.swapExecuted(`SELL swap: ${this.pairs[i].quoteAmountPerSwap} ${configQuote} for ${currentQuoteValue.toFixed(6)} ${configBase}`, {
                        symbol: swapSymbol,
                        side: 'SELL',
                        quoteAmount: this.pairs[i].quoteAmountPerSwap,
                        quoteToken: configQuote,
                        baseAmount: currentQuoteValue,
                        baseToken: configBase,
                        priceRatio: quotePriceRatio,
                    });
                } else {
                    console.log(`No action required for ${swapSymbol}, current quote value ${currentQuoteValue.toFixed(6)} is within thresholds.`);
                    continue;
                }

            } catch (error) {
                const errorMsg = (error as Error).message;
                logger.error(errorMsg);
                events.botError(`Swapper error: ${errorMsg}`, { error: errorMsg });
            }
        }

        // Swapper doesn't use limit orders, write empty state
        this.writeOrderState([]);
    }

    private parseEachPairConfig(pairs: BotConfig['swapper']['pairs']): SwapBotPair[] {
        const result: SwapBotPair[] = [];

        pairs.forEach((pair, idx) => {
            if (pair.symbol === undefined) {
                throw new Error(
                    `Market symbol option is missing for gridBot pair with index ${idx} in default.json`
                );
            }


            if (
                pair.quote === undefined ||
                pair.quoteAmountPerSwap === undefined ||
                pair.quoteMaxHold === undefined ||
                pair.quoteMinHold === undefined ||
                pair.quoteBuyMaxThreshold === undefined ||
                pair.quoteSellMinThreshold === undefined
            ) {
                throw new Error(
                    `Options are missing for market or gridBot pair ${pair.symbol} in default.json`
                );
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
    private getQuantityAndAdjustedTotal(price: BN | string, totalCost: BN, bidPrecision: number, askPrecision: number): {
        quantity: number;
        adjustedTotal: number;
    } {
        const adjustedTotal = +new BN(totalCost).times(price).toFixed(askPrecision);
        const quantity = +new BN(adjustedTotal).dividedBy(price).toFixed(bidPrecision);
        return {
            quantity,
            adjustedTotal,
        };
    }

    private async getRefreshedSwapsInfo() {
        return await getSwaps();
    }

    private getTokenFromPool(swapDetails: any, tokenName: string): any | null {
        if (swapDetails.pool1.quantity.includes(tokenName)) {
            return parseFloat(swapDetails.pool1.quantity.split(' ')[0]);
        } else if (swapDetails.pool2.quantity.includes(tokenName)) {
            return parseFloat(swapDetails.pool2.quantity.split(' ')[0]);
        } else {
            return 0;
        }
    }

    private getQuoteContractFromSymbol(swapDetails: any, tokenName: string): string {
        if (swapDetails.pool1.quantity.includes(tokenName)) {
            return swapDetails.pool1.contract;
        } else if (swapDetails.pool2.quantity.includes(tokenName)) {
            return swapDetails.pool2.contract;
        } else {
            return "";
        }
    }

    private getHighestBid(orders: TradeOrder[]): BN | null {
        const buyOrders = orders.filter((order) => order.orderSide === ORDERSIDES.BUY);
        if (buyOrders.length === 0) return null;

        buyOrders.sort((orderA, orderB): number => {
            if (BN(orderA.price).isGreaterThan(BN(orderB.price))) return -1;
            if (BN(orderA.price).isLessThan(BN(orderB.price))) return 1;
            return 0
        });

        const highestBid = new BN(buyOrders[0].price);
        return highestBid;
    }

    private getLowestAsk(orders: TradeOrder[]): BN | null {
        const sellOrders = orders.filter((order) => order.orderSide === ORDERSIDES.SELL);
        if (sellOrders.length === 0) return null;

        sellOrders.sort((orderA, orderB): number => {
            if (BN(orderA.price).isGreaterThan(BN(orderB.price))) return 1;
            if (BN(orderA.price).isLessThan(BN(orderB.price))) return -1;
            return 0;
        });

        const lowestAsk = new BN(sellOrders[0].price);
        return lowestAsk;
    }
}
