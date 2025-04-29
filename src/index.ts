/**
 * Secure Monad Wallet Manager MCP Server
 * 
 * An MCP server for Claude Desktop to check gas prices, wallet balances, and send MON tokens securely on Monad Testnet.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createPublicClient, createWalletClient, http, formatUnits, parseEther, custom, defineChain } from 'viem';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Define Monad Testnet chain
const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://spring-crimson-dawn.monad-testnet.quiknode.pro/296490a26ff50847f86f9138b97e6545aade654a/'] },
  },
});

// Create public client
const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http('https://spring-crimson-dawn.monad-testnet.quiknode.pro/296490a26ff50847f86f9138b97e6545aade654a/', { timeout: 10000 }),
});

// Initialize the MCP server
const server = new McpServer({
  name: 'secure-wallet-manager',
  version: '0.0.1',
  capabilities: ['get-gas-price', 'check-balance', 'send-mon'],
});

// Get Gas Price tool
server.tool(
  'get-gas-price',
  'Get the current or average gas price on Monad Testnet',
  {
    average: z.boolean().default(false).describe('If true, returns average gas price over last 5 blocks; if false, returns current gas price'),
  },
  async ({ average }) => {
    try {
      let gasPrice: bigint;
      if (average) {
        const blockPromises = [];
        const latestBlock = await publicClient.getBlockNumber();
        for (let i = 0; i < 5; i++) {
          const blockNumber = latestBlock - BigInt(i);
          if (blockNumber >= 0) {
            blockPromises.push(publicClient.getBlock({ blockNumber }));
          }
        }
        const blocks = await Promise.all(blockPromises);
        const gasPrices = blocks
          .filter(block => block.baseFeePerGas !== undefined)
          .map(block => block.baseFeePerGas!);
        if (gasPrices.length === 0) {
          throw new Error('No valid gas prices found in recent blocks');
        }
        gasPrice = gasPrices.reduce((sum, price) => sum + price, BigInt(0)) / BigInt(gasPrices.length);
      } else {
        gasPrice = await publicClient.getGasPrice();
      }

      const gasPriceGwei = formatUnits(gasPrice, 9);
      return {
        content: [
          {
            type: 'text',
            text: `Current gas price on Monad Testnet: ${gasPriceGwei} gwei${average ? ' (average over last 5 blocks)' : ''}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to retrieve gas price. Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  }
);

// Check Balance tool
server.tool(
  'check-balance',
  'Check the MON balance of a wallet address on Monad Testnet',
  {
    address: z.string().refine(
      (val) => /^0x[a-fA-F0-9]{40}$/.test(val),
      { message: 'Invalid Ethereum address' }
    ),
  },
  async ({ address }) => {
    try {
      const balance = await publicClient.getBalance({ address: address as `0x${string}` });
      const balanceMon = formatUnits(balance, 18);

      return {
        content: [
          {
            type: 'text',
            text: `Balance for ${address}: ${balanceMon} MON`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to retrieve balance for ${address}. Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  }
);

// Send MON tool (using .env private key)
server.tool(
  'send-mon',
  'Send MON tokens to a specified address on Monad Testnet using private key from .env',
  {
    toAddress: z.string().refine(
      (val) => /^0x[a-fA-F0-9]{40}$/.test(val),
      { message: 'Invalid Ethereum address' }
    ),
    amount: z.string().describe('Amount of MON to send (e.g., "0.1")'),
  },
  async ({ toAddress, amount }) => {
    try {
      const privateKey = process.env.PRIVATE_KEY;
      if (!privateKey) {
        throw new Error('Private key not found in .env file');
      }

      const walletClient = createWalletClient({
        chain: monadTestnet,
        transport: custom({
          async request({ method, params }) {
            return publicClient.request({ method, params } as any);
          },
        }),
        account: privateKey as `0x${string}`,
      });

      const monAmount = parseEther(amount);
      if (monAmount <= 0) {
        throw new Error('Amount must be greater than 0');
      }

      const balance = await publicClient.getBalance({ address: walletClient.account.address });
      if (balance < monAmount) {
        throw new Error(`Insufficient balance: ${formatUnits(balance, 18)} MON available`);
      }

      const gasPrice = await publicClient.getGasPrice();
      const tx = {
        to: toAddress as `0x${string}`,
        value: monAmount,
        gasPrice,
      };
      const txHash = await walletClient.sendTransaction(tx);

      return {
        content: [
          {
            type: 'text',
            text: `Successfully sent ${amount} MON to ${toAddress}. Transaction: ${txHash}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to send MON. Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  }
);

/**
 * Main function to start the MCP server
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Secure Monad Wallet Manager MCP Server running on stdio');
}

// Start the server
main().catch((error) => {
    console.error('Fatal error in main():', error);
    process.exit(1);
  });
