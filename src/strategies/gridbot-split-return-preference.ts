// grid bot strategy
import { BigNumber as BN } from 'bignumber.js';
import { ORDERSIDES } from '../core/constants';
import { BotConfig, GridBotPair, TradeOrder, TradingStrategy } from '../interfaces';
import { configValueToFloat, configValueToInt, getConfig, getLogger, getUsername } from '../utils';
import { TradingStrategyBase } from './base';
import { fetchTokenBalance } from '../dexapi';
import fs from "fs";

const logFileName = './gridbot-logs-' + getUsername() + '.txt';

const logger = getLogger();
const config = getConfig();

function logItem(item: string | object, label?: string ) {
  if(typeof item === 'object') {
    item = JSON.stringify(item, null, 2);
  }
  if(label) {
    item = `${label}: ${item}`;
  }
  fs.appendFileSync(logFileName, item + '\n\n');
}
/**
 * Grid Trading Bot Strategy
 * Grid Trading Bots are programs that allow users to automatically buy low and sell high within a pre-set price range.
 * The number of orders is determined by config values like limits, gridLevels, refer config/default.json
 */
export class GridBotStrategy extends TradingStrategyBase implements TradingStrategy {
  private oldOrders: TradeOrder[][] = []
  private pairs: GridBotPair[] = [];

  async initialize(options?: BotConfig['gridBot']): Promise<void> {
    if(options){
      this.pairs = this.parseEachPairConfig(options.pairs);
      this.pairs.forEach((_, i) => {
        this.oldOrders[i] = [];
      })
    }
  }
  
  async trade(): Promise<void> {
    for (var i = 0; i < this.pairs.length; i++) {
      try {
        console.log("Checking for trades");
        const marketSymbol = this.pairs[i].symbol;
        const marketDetails = await this.getMarketDetails(marketSymbol);
        const { market } = marketDetails;
        if(!market) {
          console.log('Invalid market');
          continue;
        }
        
        // Number of grid levels for the current pair
        const gridLevels = this.pairs[i].gridLevels;
        // Precision of the bid and ask tokens
        const bidPrecision = market.bid_token.precision;
        const askPrecision = market.ask_token.precision;
        
        // Last sale price of the market
        const lastSalePrice = new BN(marketDetails.price).toFixed(askPrecision);
        const openOrders = await this.getOpenOrders(marketSymbol);
        // Upper and lower limit for trading within the current pair
        const upperLimit = new BN(
          this.pairs[i].upperLimit * 10 ** bidPrecision
        );
        const lowerLimit = new BN(
          this.pairs[i].lowerLimit * 10 ** bidPrecision
        );

        // How many tokens to buy/sell at each grid level
        const bidAmountPerLevel = new BN(this.pairs[i].bidAmountPerLevel);
        const gridSize = upperLimit.minus(lowerLimit).dividedBy(gridLevels);
        // Convert the grid size to the precision of the bid/ask token pair
        const gridPrice = gridSize
          .dividedBy(10 ** bidPrecision)
          .toFixed(askPrecision);
        let latestOrders = [];
        const username = getUsername();

        if (!this.oldOrders[i].length) {
          // Place orders on bot initialization
          let index = 0;
          let maxGrids = gridLevels;
          logger.info(`gridLevels ${gridLevels}, ${maxGrids}`);
          if(!maxGrids)
            continue;
          const priceTraded = new BN(lastSalePrice).times(10 ** bidPrecision);
          logger.info(`upperLimit ${upperLimit}, lowerLimit: ${lowerLimit}, priceTraded: ${priceTraded}`);
          if(upperLimit.isGreaterThanOrEqualTo(priceTraded) && lowerLimit.isGreaterThanOrEqualTo(priceTraded))  maxGrids -= 1;
          if(upperLimit.isLessThanOrEqualTo(priceTraded) && lowerLimit.isLessThanOrEqualTo(priceTraded))   index = 1;
          var sellToken = 0;
          var buyToken = 0;
          for (; index <= maxGrids; index += 1) {
            const price = upperLimit
              .minus(gridSize.multipliedBy(index))
              .dividedBy(10 ** bidPrecision)
              .toFixed(askPrecision);
            const { quantity, adjustedTotal } = this.getQuantityAndAdjustedTotal(
              price,
              bidAmountPerLevel,
              bidPrecision,
              askPrecision
            );
            const validOrder = new BN(
              Math.abs(parseFloat(price) - parseFloat(lastSalePrice))
            ).isGreaterThanOrEqualTo(+gridPrice / 2);

            const validBuyOrder = new BN(
              (parseFloat(lastSalePrice) - parseFloat(price))
            ).isGreaterThan(0);

            const validSellOrder = new BN(
              (parseFloat(price) - parseFloat(lastSalePrice))
            ).isGreaterThan(0);

            // Prepare orders and push into a list
            if (validOrder) {
              if (validSellOrder) {
                const order = {
                  orderSide: ORDERSIDES.SELL,
                  price: +price,
                  quantity: quantity,
                  marketSymbol,
                };
                sellToken += quantity;
                this.oldOrders[i].push(order);
              } else if (validBuyOrder) {
                const order = {
                  orderSide: ORDERSIDES.BUY,
                  price: +price,
                  quantity: adjustedTotal,
                  marketSymbol,
                };
                buyToken += adjustedTotal;
                this.oldOrders[i].push(order);
              }
            }
          }
          const sellTotal = new BN(sellToken).toFixed(bidPrecision);
          const buyTotal = new BN(buyToken).toFixed(askPrecision);
          const sellBalances  = await fetchTokenBalance(username, market.bid_token.contract, market.bid_token.code);
          const buyBalances = await fetchTokenBalance(username, market.ask_token.contract, market.ask_token.code);
          if(sellTotal > sellBalances || buyTotal > buyBalances) {
            logger.error(`LOW BALANCES - Current balance ${sellBalances} ${market.bid_token.code} - Expected ${sellTotal} ${market.bid_token.code}
                      Current balance ${buyBalances} ${market.ask_token.code} - Expected ${buyTotal} ${market.ask_token.code}`);
            logger.info(` Overdrawn Balance - Not placing orders for ${market.bid_token.code}-${market.ask_token.code} `);
            continue;
          }
          // Makesure to place only maxGrids order, as there is a possibility to place 1 additional order because of the non divisible configuration
          if (this.oldOrders[i].length <= maxGrids) {
            console.log("Not Placing Orders");
            // await this.placeOrders(this.oldOrders[i]);
          }
        } else if (openOrders.length > 0 && openOrders.length < gridLevels) {
          // compare open orders with old orders and placce counter orders for the executed orders
          let currentOrders: TradeOrder[] = openOrders.map((order) => ({
            orderSide: order.order_side,
            price: order.price,
            quantity: order.quantity_curr,
            marketSymbol,
          }));
          for (var j = 0; j < this.oldOrders[i].length; j++) {
            const newOrder = openOrders.find(
              (openOrders) =>
                openOrders.price === this.oldOrders[i][j].price
            );
            if (!newOrder) {
              const buySellString = "Completed " + (this.oldOrders[i][j].orderSide == ORDERSIDES.BUY ? "BUY" : (this.oldOrders[i][j].orderSide == ORDERSIDES.SELL ? "SELL" : "INVALID")) + " order for " + this.oldOrders[i][j].quantity + " " + this.oldOrders[i][j].marketSymbol + " at " + this.oldOrders[i][j].price;
              logger.info(buySellString);

              logItem(buySellString);
              logItem({
                Market: market,
                gridLevels,
                bidPrecision,
                askPrecision,
                lastSalePrice,
                upperLimit,
                lowerLimit,
                bidAmountPerLevel,
                gridSize,
                gridPrice
              }, "Attributes");
             
              if (this.oldOrders[i][j].orderSide === ORDERSIDES.BUY) {
                const lowestAsk = this.getLowestAsk(currentOrders);
                var sellPrice;
                // Place a counter sell order for the executed buy order
                if (!lowestAsk || config.gridPlacement)
                  sellPrice = new BN(this.oldOrders[i][j].price)
                    .plus(gridPrice)
                    .toFixed(askPrecision);
                else
                  sellPrice = new BN(lowestAsk)
                    .minus(gridPrice)
                    .toFixed(askPrecision);
                const { quantity } = this.getQuantityAndAdjustedTotal(
                  sellPrice,
                  bidAmountPerLevel,
                  bidPrecision,
                  askPrecision
                );
                const order = {
                  orderSide: ORDERSIDES.SELL,
                  price: +sellPrice,
                  quantity: quantity,
                  marketSymbol,
                };

                logItem({
                  sellPrice,
                  quantity,
                  order,
                }, "Counter Order - SELL");
               
                latestOrders.push(order);
                currentOrders.push(order);
              } else if (this.oldOrders[i][j].orderSide === ORDERSIDES.SELL) {
                const highestBid = this.getHighestBid(currentOrders);
                // Place a counter buy order for the executed sell order
                var buyPrice;
                if (!highestBid || config.gridPlacement)
                  buyPrice = new BN(this.oldOrders[i][j].price)
                    .minus(gridPrice)
                    .toFixed(askPrecision);
                else
                  buyPrice = new BN(highestBid)
                    .plus(gridPrice)
                    .toFixed(askPrecision); 
                
                // Divide the spread (i.e. gridPrice) by the old order price to get the percentage spread
                const calculatedTotalPercentSpread = BN(gridPrice).dividedBy(new BN(this.oldOrders[i][j].price)).times(100); 
                logItem("Calculated Percent Spread: " + calculatedTotalPercentSpread);

                // If the spread is 0.3%, then we need to adjust the bidAmountPerLevel by ((calculatedPercentSpread - 0.1) / 2) + 0.1
                // For example, if the spread is 0.3%, then the bidAmountPerLevel will be adjusted by ((0.3 - 0.1) / 2) + 0.1 = 0.2 / 2 + 0.1 = 0.1 + 0.1 = 0.2
                // This means that the bidAmountPerLevel will be increased by 0.2% for the next order
                const calculatedPurchaseSpread = calculatedTotalPercentSpread.minus(0.1).dividedBy(2).plus(0.1);
                // Convert this to a value that can be added to the bidAmountPerLevel
                const calculatedDifference = BN(bidAmountPerLevel).times(calculatedPurchaseSpread.dividedBy(100));
                // Add the calculated difference to the bidAmountPerLevel to get the adjusted bidAmountPerLevel
                const adjustedBidAmountPerLevel = BN(bidAmountPerLevel).plus(calculatedDifference);
                
                logItem({
                  calculatedTotalPercentSpread,
                  calculatedPurchaseSpread,
                  calculatedDifference,
                  representativeSpread: bidAmountPerLevel.plus(BN(bidAmountPerLevel).times(calculatedTotalPercentSpread.dividedBy(100))),
                  bidAmountPerLevel,
                  adjustedBidAmountPerLevel,
                });

                const { adjustedTotal } = this.getQuantityAndAdjustedTotal(
                  buyPrice,
                  adjustedBidAmountPerLevel,
                  bidPrecision,
                  askPrecision
                );

                const order = {
                  orderSide: ORDERSIDES.BUY,
                  price: +buyPrice,
                  quantity: adjustedTotal,
                  marketSymbol,
                };

                logItem({
                  buyPrice,
                  adjustedTotal,
                  order,
                }, "Counter Order - BUY");

                latestOrders.push(order);
                currentOrders.push(order);
              }
            }
          }
          // await this.placeOrders(latestOrders);
          // Update old orders for next round of inspection
          console.log("Latest Orders", latestOrders);
          console.log("Finishing Loop");
          this.oldOrders[i] = currentOrders;
        }
      } catch (error) {
        logger.error((error as Error).message);
      }
    }
  }

  private parseEachPairConfig(pairs: BotConfig['gridBot']['pairs']): GridBotPair[] {
    const result: GridBotPair[] = [];
    
    pairs.forEach((pair, idx) => {
      if (pair.symbol === undefined) {
        throw new Error(
          `Market symbol option is missing for gridBot pair with index ${idx} in default.json`
        );
      }
  
      if (
        pair.upperLimit === undefined ||
        pair.lowerLimit === undefined ||
        pair.gridLevels === undefined ||
        pair.bidAmountPerLevel === undefined
      ) {
        throw new Error(
          `Options are missing for market or gridBot pair ${pair.symbol} in default.json`
        );
      }
  
      result.push({
        symbol: pair.symbol,
        upperLimit: configValueToFloat(pair.upperLimit),
        lowerLimit: configValueToFloat(pair.lowerLimit),
        gridLevels: configValueToInt(pair.gridLevels),
        bidAmountPerLevel: configValueToFloat(pair.bidAmountPerLevel),
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

  private getHighestBid(orders: TradeOrder[]): BN | null{
    const buyOrders = orders.filter((order) => order.orderSide === ORDERSIDES.BUY);
    if (buyOrders.length === 0) return null;
    
    buyOrders.sort((orderA, orderB): number => {
      if(BN(orderA.price).isGreaterThan(BN(orderB.price))) return -1;
      if(BN(orderA.price).isLessThan(BN(orderB.price))) return 1;
      return 0
    });
  
    const highestBid = new BN(buyOrders[0].price);
    return highestBid;
  }
  
  private getLowestAsk(orders: TradeOrder[]): BN | null {
    const sellOrders = orders.filter((order) => order.orderSide === ORDERSIDES.SELL);
    if (sellOrders.length === 0) return null;
  
    sellOrders.sort((orderA, orderB): number => {
      if(BN(orderA.price).isGreaterThan(BN(orderB.price))) return 1;
      if(BN(orderA.price).isLessThan(BN(orderB.price))) return -1;
      return 0;
    });
  
    const lowestAsk = new BN(sellOrders[0].price);
    return lowestAsk;
  }
}
