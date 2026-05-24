// Domain types — filled in during M1.
export type AssetClass = never
export type AccountType = never
export type PlacementBucket = never
export interface Account { id: string }
export interface Position { accountId: string; ticker: string; marketValue: number }
export interface Strategy { targets: Record<string, number> }
export interface Trade { accountId: string; deltaUsd: number }
export interface RebalanceResult { trades: Trade[] }
export type Flag = never
