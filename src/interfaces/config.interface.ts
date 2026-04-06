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

export interface SpikeBotPair {
    symbol: string;
    deviationPct: number;
    levels: number;
    orderAmount: number;
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


export interface MomentumBotConfig {
    symbol: string;
    interval: string;
    lookbackPeriods: number;
    rsiOverbought: number;
    rsiOversold: number;
    bollingerStdDev: number;
    orderAmount: number;
    maxPositions: number;
}

export interface ScannerBotConfig {
    minVolumeThreshold: number;
    minChangePct: number;
    maxPairs: number;
    orderAmount: number;
    holdDurationCycles: number;
}

export interface CopyTraderConfig {
    targetAccounts: string[];
    symbol?: string;
    copyPct: number;
    maxOrderAmount: number;
}

export interface WhaleWatcherConfig {
    watchTokens: string[];
    minTransferAmount: number;
    symbol: string;
    orderAmount: number;
    actionDelay: number;
}

export interface SpreadBotConfig {
    symbol: string;
    maxSpreadPct: number;
    minSpreadPct: number;
    orderAmount: number;
    depthLevels: number;
    rebalanceThresholdPct: number;
}

export interface TWAPBotConfig {
    symbol: string;
    side: 'BUY' | 'SELL';
    totalAmount: number;
    durationMinutes: number;
    sliceCount: number;
    maxSlippage: number;
    avoidHighVolatility: boolean;
}

export interface ArbBotConfig {
    pairs: [string, string, string];
    minProfitPct: number;
    orderAmount: number;
}

export interface HealthMonitorConfig {
    errorThreshold: number;
    enabled: boolean;
    cancelOrdersOnRestart: boolean;
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
    mode?: 'live' | 'paper';
    paperTrading?: {
        startingBalances?: Record<string, number>;
    };
    strategy: 'gridBot' | 'gridBotSplitReturnPreference' | 'marketMaker' | 'swapper' | 'spikeBot'
        | 'momentumBot' | 'scannerBot' | 'copyTrader' | 'whaleWatcher' | 'spreadBot' | 'twapBot' | 'arbBot';
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
    spikeBot: {
        pairs: SpikeBotPair[];
        maWindow: number;
        rebalanceThresholdPct: number;
    };
    momentumBot?: MomentumBotConfig;
    scannerBot?: ScannerBotConfig;
    copyTrader?: CopyTraderConfig;
    whaleWatcher?: WhaleWatcherConfig;
    spreadBot?: SpreadBotConfig;
    twapBot?: TWAPBotConfig;
    arbBot?: ArbBotConfig;
    rpc: {
        privateKeyPermission: string;
        endpoints: string[];
        apiRoot: string;
        lightApiRoot: string;
        privateKey: string;
    };
    username: string;
    dashboard?: DashboardConfig;
    healthMonitor?: HealthMonitorConfig;
}