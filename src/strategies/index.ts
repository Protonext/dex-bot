import { TradingStrategy, TradingStrategyConstructor } from '../interfaces';
import { GridBotStrategy } from './gridbot';
import { SplitReturnGridStrategy } from './gridbot-split-return-preference';
import { MarketMakerStrategy } from './marketmaker';
import { SwapBotStrategy } from './swapper';
import { SpikeBotStrategy } from './spikebot';
import { MomentumBotStrategy } from './momentumbot';
import { ScannerBotStrategy } from './scannerbot';
import { CopyTraderStrategy } from './copytrader';
import { WhaleWatcherStrategy } from './whalewatcher';
import { SpreadBotStrategy } from './spreadbot';
import { TWAPBotStrategy } from './twapbot';
import { ArbBotStrategy } from './arbbot';

const strategiesMap = new Map<string, TradingStrategyConstructor>([
    ['gridBot', GridBotStrategy],
    ['gridBotSplitReturnPreference', SplitReturnGridStrategy],
    ['marketMaker', MarketMakerStrategy],
    ['swapper', SwapBotStrategy],
    ['spikeBot', SpikeBotStrategy],
    ['momentumBot', MomentumBotStrategy],
    ['scannerBot', ScannerBotStrategy],
    ['copyTrader', CopyTraderStrategy],
    ['whaleWatcher', WhaleWatcherStrategy],
    ['spreadBot', SpreadBotStrategy],
    ['twapBot', TWAPBotStrategy],
    ['arbBot', ArbBotStrategy],
])

export function getStrategy(name: string): TradingStrategy {
    const strategy = strategiesMap.get(name);
    if (strategy) {
        return new strategy();
    }
    throw new Error(`No strategy named ${name} found.`)
}
