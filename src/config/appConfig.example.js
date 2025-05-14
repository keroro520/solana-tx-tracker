// src/config/appConfig.example.js
// IMPORTANT: COPY THIS FILE to appConfig.js (which is gitignored) and fill in your actual details.

export const appConfig = {
  // Replace with your actual private key. 
  // It can be a Base58 encoded string or a Uint8Array/number[] representation of the secret key bytes.
  // Example Base58 string: "YourBase58PrivateKeyString..."
  // Example Byte Array: [1, 2, 3, ..., 64] (must be 64 bytes for a Solana secret key)
  privateKey: "YOUR_SOLANA_PRIVATE_KEY_IN_BASE58_OR_BYTE_ARRAY_FORMAT",

  endpoints: [
    {
      name: "Solana Mainnet (Public - api.mainnet-beta.solana.com)",
      rpcUrl: "https://api.mainnet-beta.solana.com",
      wsUrl: "wss://api.mainnet-beta.solana.com/"
    },
    {
      name: "Solana Devnet (Public - api.devnet.solana.com)",
      rpcUrl: "https://api.devnet.solana.com",
      wsUrl: "wss://api.devnet.solana.com/"
    },
    // Add more custom endpoints here if needed, for example a local test validator:
    // {
    //   name: "Local Test Validator",
    //   rpcUrl: "http://127.0.0.1:8899",
    //   wsUrl: "ws://127.0.0.1:9000/"
    // },
  ]
}; 