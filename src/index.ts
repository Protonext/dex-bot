import { getConfig, getLogger } from './utils';
import * as dexapi from './dexapi';
import * as dexrpc from './dexrpc';
import { getStrategy } from './strategies';
import readline from 'readline';
import { postSlackMsg } from './slackapi';
import { events } from './events';

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const execTrade = async () => {
  console.log('Bot is live');
  await currentStrategy.trade()
  await delay(config.tradeIntervalMS)
  execTrade()
}

const execSlack = async () => {
  await postSlackMsg()
  await delay(config.slackIntervalMS)
  execSlack()
}
const config = getConfig();
const currentStrategy = getStrategy(config.strategy);
currentStrategy.initialize(config[config.strategy]);

// Initialize dashboard events
events.initialize();

/**
 * Main
 * This sets up the logic for the application, the looping, timing, and what to do on exit.
 */
const main = async () => {
  const logger = getLogger();

  await dexapi.initialize();

  // Emit bot started event
  events.botStarted(`Bot started with strategy: ${config.strategy}`);
  events.configLoaded('Configuration loaded', {
    strategy: config.strategy,
    username: config.username,
    tradeIntervalMS: config.tradeIntervalMS,
  });

  try {
    process.stdin.resume();
    if (config.cancelOpenOrdersOnExit) {
      if (process.platform === "win32") {
        var rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });

        rl.on("SIGINT", function () {
          process.emit("SIGINT");
        });
      }

      async function signalHandler() {
        events.botStopped('Bot shutting down - cancelling all orders');
        events.shutdown();
        await dexrpc.cancelAllOrders();
        process.exit();
      }

      process.on('SIGINT', signalHandler)
      process.on('SIGTERM', signalHandler)
      process.on('SIGQUIT', signalHandler)
    }

    if (config.strategy !== 'swapper') {
      await currentStrategy.trade()
      logger.info(`Waiting for few seconds before fetching the placed orders`);
      await delay(15000)
      execTrade()
      execSlack()
    } else {
      execTrade()
      execSlack()
    }
  } catch (error) {
    const errorMsg = (error as Error).message;
    logger.error(errorMsg);
    events.botError(`Fatal error: ${errorMsg}`, { error: errorMsg });
  }
};

// start it all up
await main();