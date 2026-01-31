export interface GridBotPair {
    symbol: string;
    upperLimit: number;
    lowerLimit: number;
    gridLevels: number;
    bidAmountPerLevel: number;
}

export interface GridBotPairRaw extends Omit<GridBotPair, 'upperLimit' | 'lowerLimit' | 'gridLevels' | 'bidAmountPerLevel'> {
    upperLimit: number | string;
    lowerLimit: number | string;
    gridLevels: number | string;
    bidAmountPerLevel: number | string;
}

export interface MarketMakerPair {
    symbol: string;
    gridLevels: number;
    gridInterval: number;
    base: number;
    orderSide: number;
    bidAmountPerLevel: number;
}

export interface SwapBotPair {
    symbol: string;
    quote: string;
    quoteAmountPerSwap: number;
    quoteMaxHold: number;
    quoteMinHold: number;
    quoteBuyMaxThreshold: number;
    quoteSellMinThreshold: number;
    base: string;
}


export interface DashboardConfig {
    url: string;
    apiKey: string;
    instanceId: string;
    enabled?: boolean;
}

export interface BotConfig {
    tradeIntervalMS: number;
    slackIntervalMS: number;
    slackBotToken: string;
    channelId: string;
    cancelOpenOrdersOnExit: boolean;
    gridPlacement: boolean;
    strategy: 'gridBot' | 'gridBotSplitReturnPreference' | 'marketMaker' | 'swapper';
    marketMaker: {
        pairs: MarketMakerPair[];
    };
    gridBot: {
        pairs: GridBotPairRaw[]
    };
    gridBotSplitReturnPreference: {
        pairs: GridBotPairRaw[]
    };
    swapper: {
        pairs: SwapBotPair[];
    };
    rpc: {
        privateKeyPermission: string;
        endpoints: string[];
        apiRoot: string;
        lightApiRoot: string;
        privateKey: string;
    };
    username: string;
    dashboard?: DashboardConfig;
}