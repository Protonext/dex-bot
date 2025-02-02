const fs = require('fs'); // File system operations
const fetch = require('node-fetch'); // Fetch API for Node.js
const readline = require('readline'); // User input

const API_URL = 'https://your-endpoint.com/trades'; // Replace with actual endpoint

// Function to prompt user for a username
async function getUsername() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('Enter your username: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Function to fetch trade data from API
async function fetchTradeData(username) {
  try {
    const url = `${API_URL}?account=${encodeURIComponent(username)}`;
    console.log(`Fetching fresh data for user: ${username}...`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const csvData = await response.text();
    const parsedData = parseCSV(csvData);

    // Save to user-specific cache file
    const cacheFile = `trades_${username}.json`;
    fs.writeFileSync(cacheFile, JSON.stringify(parsedData, null, 2));
    console.log(`✅ Fresh data fetched and cached in ${cacheFile}.`);

    return parsedData;
  } catch (error) {
    console.error('Error fetching trade data:', error);
    return [];
  }
}

// Function to read cached trade data
function readCachedTradeData(username) {
  const cacheFile = `trades_${username}.json`;
  if (fs.existsSync(cacheFile)) {
    try {
      const rawData = fs.readFileSync(cacheFile);
      const parsedData = JSON.parse(rawData);
      console.log(`✅ Using cached trade data from ${cacheFile}.`);
      return parsedData;
    } catch (error) {
      console.error('Error reading cached data:', error);
    }
  }
  return null;
}

// Function to parse CSV into JSON objects
function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  const headers = lines.shift().split(',');

  return lines.map((line) => {
    const values = line.split(',');
    return headers.reduce((obj, header, index) => {
      obj[header.trim()] = values[index]?.trim();
      return obj;
    }, {});
  });
}

// Function to get trade data (cached or live)
async function getTradeData(username, useCache = true) {
  if (useCache) {
    const cachedData = readCachedTradeData(username);
    if (cachedData) return cachedData;
  }
  return await fetchTradeData(username);
}

// Compute average price for buy/sell trades
function computeAveragePrice(trades, amountKey, priceKey) {
  const totalAmount = trades.reduce((sum, trade) => sum + parseFloat(trade[amountKey] || 0), 0);
  const totalValue = trades.reduce((sum, trade) => sum + parseFloat(trade[priceKey] || 0), 0);

  return totalAmount > 0 ? (totalValue / totalAmount) : 0;
}

// Calculate profit for each trade
function calculateTradeProfits(trades) {
  return trades.map((trade) => {
    const buyAmount = parseFloat(trade['Buy Amount']);
    const sellAmount = parseFloat(trade['Sell Amount']);
    const fee = parseFloat(trade['Fee']);

    trade.Profit = (sellAmount - buyAmount - fee).toFixed(4);
    return trade;
  });
}

// Main function
async function main() {
  const username = await getUsername();
  const useCache = true; // Change to false to force fresh API call
  let TRADES = await getTradeData(username, useCache);

  console.log(`Loaded ${TRADES.length} trades for user ${username}.`);

  // Example analysis functions
  const avgBuyPrice = computeAveragePrice(TRADES, 'Buy Amount', 'Sell Amount');
  const avgSellPrice = computeAveragePrice(TRADES, 'Sell Amount', 'Buy Amount');

  console.log('Average Buy Price:', avgBuyPrice.toFixed(4));
  console.log('Average Sell Price:', avgSellPrice.toFixed(4));

  const tradesWithProfit = calculateTradeProfits(TRADES);
  console.log('Trades with Profits:', tradesWithProfit);
}

// Execute the script
main();
