export interface TrackedAsset {
  symbol: string;
  // null: resolved at runtime from the xStocks asset record's Solana deployment.
  mint: string | null;
  liquidityClass: "liquid" | "thin";
}

export const TRACKED_ASSETS: readonly TrackedAsset[] = [
  { symbol: "NVDAx", mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", liquidityClass: "liquid" },
  { symbol: "TSLAx", mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", liquidityClass: "liquid" },
  { symbol: "SPYx", mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", liquidityClass: "liquid" },
  { symbol: "AAPLx", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", liquidityClass: "liquid" },
  { symbol: "MSTRx", mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", liquidityClass: "liquid" },
  { symbol: "CRCLx", mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1", liquidityClass: "liquid" },
  { symbol: "QQQx", mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", liquidityClass: "thin" },
  { symbol: "METAx", mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", liquidityClass: "thin" },
  { symbol: "GOOGLx", mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", liquidityClass: "thin" },
  { symbol: "AMZNx", mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", liquidityClass: "thin" },
  { symbol: "COINx", mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu", liquidityClass: "thin" },
  { symbol: "MSFTx", mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", liquidityClass: "thin" },
  { symbol: "NFLXx", mint: "XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL", liquidityClass: "thin" },
  { symbol: "HOODx", mint: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg", liquidityClass: "thin" },
  { symbol: "GLDx", mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re", liquidityClass: "thin" },
  { symbol: "JPMx", mint: "XsMAqkcKsUewDrzVkait4e5u4y8REgtyS7jWgCpLV2C", liquidityClass: "thin" },
  { symbol: "DISx", mint: "Xsg93jDV656ULQ5u9yT2x5DS9b4xGD8aDCtfESSW6Bb", liquidityClass: "thin" },
  { symbol: "GMEx", mint: "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc", liquidityClass: "thin" },
  { symbol: "INTCx", mint: "XshPgPdXFRWB8tP1j82rebb2Q9rPgGX37RuqzohmArM", liquidityClass: "thin" },
  { symbol: "AMDx", mint: "XsXcJ6GZ9kVnjqGsjBnktRcuwMBmvKWh8S93RefZ1rF", liquidityClass: "thin" },
  { symbol: "AVGOx", mint: null, liquidityClass: "thin" },
  { symbol: "PLTRx", mint: null, liquidityClass: "thin" },
  { symbol: "ORCLx", mint: null, liquidityClass: "thin" },
  { symbol: "CRMx", mint: null, liquidityClass: "thin" },
  { symbol: "CRWDx", mint: null, liquidityClass: "thin" },
  { symbol: "APPx", mint: null, liquidityClass: "thin" },
  { symbol: "LLYx", mint: null, liquidityClass: "thin" },
  { symbol: "UNHx", mint: null, liquidityClass: "thin" },
  { symbol: "Vx", mint: null, liquidityClass: "thin" },
  { symbol: "MAx", mint: null, liquidityClass: "thin" },
  { symbol: "WMTx", mint: null, liquidityClass: "thin" },
  { symbol: "XOMx", mint: null, liquidityClass: "thin" },
] as const;

export function findTrackedAsset(symbol: string) {
  return TRACKED_ASSETS.find(
    (asset) => asset.symbol.toLowerCase() === symbol.toLowerCase(),
  );
}
