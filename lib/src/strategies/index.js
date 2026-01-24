import { GridBotStrategy } from './gridbot';
import { MarketMakerStrategy } from './marketmaker';
import { SwapBotStrategy } from './swapper';
const strategiesMap = new Map([
    ['gridBot', GridBotStrategy],
    ['marketMaker', MarketMakerStrategy],
    ['swapper', SwapBotStrategy],
]);
export function getStrategy(name) {
    const strategy = strategiesMap.get(name);
    if (strategy) {
        return new strategy();
    }
    throw new Error(`No strategy named ${name} found.`);
}
//# sourceMappingURL=index.js.map