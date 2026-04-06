
export interface TradingStrategy {
    initialize(options?: any): Promise<void>;
    trade(): Promise<void>;
    cancelOwnOrders(): Promise<void>;
}

export interface TradingStrategyConstructor {
    new (): TradingStrategy;
}
