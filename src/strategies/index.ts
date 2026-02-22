import { TradingStrategy, TradingStrategyConstructor } from '../interfaces';
import { GridBotStrategy } from './gridbot';
import { SplitReturnGridStrategy } from './gridbot-split-return-preference';
import { MarketMakerStrategy } from './marketmaker';
import { SwapBotStrategy } from './swapper';
import { SpikeBotStrategy } from './spikebot';

const strategiesMap = new Map<string, TradingStrategyConstructor>([
    ['gridBot', GridBotStrategy],
    ['gridBotSplitReturnPreference', SplitReturnGridStrategy],
    ['marketMaker', MarketMakerStrategy],
    ['swapper', SwapBotStrategy],
    ['spikeBot', SpikeBotStrategy],
])

export function getStrategy(name: string): TradingStrategy {
    const strategy = strategiesMap.get(name);
    if (strategy) {
        return new strategy();
    }
    throw new Error(`No strategy named ${name} found.`)
}
