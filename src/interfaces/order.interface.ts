import { ORDERSIDES } from '../core/constants';

export interface TradeOrder {
    orderSide: ORDERSIDES;
    price: number;
    quantity: number;
    marketSymbol: string;
}

export interface TrackedOrder extends TradeOrder {
    orderId?: string;    // on-chain order_id from the DEX
    placedAt?: string;   // ISO timestamp for debugging
}