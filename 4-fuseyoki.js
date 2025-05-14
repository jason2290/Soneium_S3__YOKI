import fs from 'fs';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { Worker, isMainThread, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';
import csv from 'csv-parser';

dotenv.config(); // 載入環境變數

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RPC_URL = 'https://rpc.soneium.org/';
const CONTRACT_ADDRESS = '0x80e041b16a38f4caa1d0137565b37fd71b2f1e2b'; // 目標合約地址
const GAS_PRICE_FILE = '/Users/chiatsetsai/Desktop/VSCODE3/1-Mithraeum/currentGasPrice.txt';
const NUM_THREADS = 14; // 設置線程數量

// NFT 編號與 nftid 對應
const nftIdMap = {
  1: '0064',
  2: '00c8',
  3: '012c',
  4: '0190',
  5: '01f4',
  6: '0258',
  7: '02bc',
  8: '0320',
  9: '0384',
  10: '03e8',
  11: '044c',
  12: '04b0',
};

// Fuse 編號與 fuseid 對應
const fuseIdMap = {
  1: '0065',
  2: '00c9',
  3: '012d',
  4: '0191',
  5: '01f5',
  6: '0259',
  7: '02bd',
  8: '0321',
  9: '0385',
  10: '03e9',
  11: '044d',
  12: '04b1',
};

// 讀取 config.csv
async function readConfigFromCSV() {
  const results = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream('config.csv')
      .pipe(csv({ mapHeaders: ({ header }) => header.trim() })) // 清理 header 中的空格
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error));
  });
}

// 隨機打亂數組
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// 隨機間隔，5到15秒
function getRandomInterval() {
  return Math.floor(Math.random() * (5000 - 1000 + 1)) + 5000; // 5000到15000毫秒
}

// 讀取最新的 gasPrice
function readGasPriceFromFile() {
  const gasPrice = fs.readFileSync(GAS_PRICE_FILE, 'utf-8');
  const gasPriceInGwei = parseFloat(gasPrice) / 1e9; // 將數字除以 10 的九次方
  return ethers.parseUnits(gasPriceInGwei.toString(), 'gwei'); // 轉換為 Gwei
}

// 等待交易確認，設置超時機制
async function waitForTransactionConfirmation(tx, timeout = 30000) {
  const provider = tx.provider;

  const receiptPromise = tx.wait();
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`交易 ${tx.hash} 在 ${timeout / 1000} 秒內未確認成功`)), timeout)
  );

  return Promise.race([receiptPromise, timeoutPromise]);
}

// 發送交易
async function sendTransaction(privateKey, id, type, gasPrice) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`🟢 使用的 EVM 地址: ${wallet.address}`);

  // 將 receiver 設為當前錢包地址
  const receiver = wallet.address;

  // 根據 type 選擇函數選擇器
  const functionSelector = type.startsWith('NFT') ? '0x40c10f19' : '0x40c10f19';

  // 構建 calldata
  const calldata =
    functionSelector +
    '000000000000000000000000' +
    receiver.slice(2) +
    '000000000000000000000000000000000000000000000000000000000000' +
    id;

  // 手動設置 gasLimit
  const gasLimit = 246987;

  // 發送交易
  const tx = await wallet.sendTransaction({
    to: CONTRACT_ADDRESS,
    data: calldata,
    gasLimit,
    gasPrice, // 設置 gasPrice
  });

  console.log(`📨 交易發送成功，交易哈希: ${tx.hash} (${type})`);

  // 等待交易確認，設置超時機制
  try {
    const receipt = await waitForTransactionConfirmation(tx, 30000); // 設置 30 秒超時
    console.log(`✅ 交易確認，區塊號: ${receipt.blockNumber} (${type})`);
    return true;
  } catch (error) {
    console.error(`⚠️ 交易未確認 (${type}): ${error.message}`);
    fs.appendFileSync('error-script1.log', `${wallet.address} (${type})\n`); // 將錢包地址和類型輸出到 error-script1.log
    return false;
  }
}

// 執行所有交易
async function executeTransactions(configData) {
  const errorKeys = []; // 用於存儲失敗的金鑰

  for (const row of configData) {
    const privateKey = row.key;

    // 處理 nft_1 到 nft_12
    for (let nftNumber = 1; nftNumber <= 12; nftNumber++) {
      const quantity = parseInt(row[`nft_${nftNumber}`]) || 0; // 獲取數量，若空白則為 0

      // 若數量為 0 或無效，跳過
      if (quantity <= 0) {
        console.log(`⏭️ 跳過 NFT 編號 ${nftNumber} (數量: ${row[`nft_${nftNumber}`] || '空白'})`);
        continue;
      }

      const nftid = nftIdMap[nftNumber];
      console.log(`處理 NFT 編號: ${nftNumber}, nftid: ${nftid}, 數量: ${quantity}`);

      // 針對 quantity 重複執行交易
      for (let i = 0; i < quantity; i++) {
        try {
          const currentGasPrice = readGasPriceFromFile(); // 讀取最新的 gasPrice
          const success = await sendTransaction(privateKey, nftid, `NFT ${nftNumber}`, currentGasPrice); // 傳入金鑰、nftid 和類型
          if (success) {
            console.log(`🗑️ 交易成功: ${privateKey}, NFT ${nftNumber}, 第 ${i + 1} 次`);
          } else {
            errorKeys.push(privateKey); // 將失敗的金鑰添加到列表中
          }
        } catch (error) {
          console.error(`❌ 交易失敗 (NFT ${nftNumber}, 第 ${i + 1} 次): ${error.message}`);
          errorKeys.push(privateKey); // 將失敗的金鑰添加到列表中
        }
        const delay = getRandomInterval(); // 隨機間隔等待
        console.log(`⏳ 等待 ${delay / 1000} 秒後繼續`);
        await new Promise((resolve) => setTimeout(resolve, delay)); // 隨機間隔等待
      }
    }

    // 處理 fuse_1 到 fuse_12
    for (let fuseNumber = 1; fuseNumber <= 12; fuseNumber++) {
      const quantity = parseInt(row[`fuse_${fuseNumber}`]) || 0; // 獲取數量，若空白則為 0

      // 若數量為 0 或無效，跳過
      if (quantity <= 0) {
        console.log(`⏭️ 跳過 Fuse 編號 ${fuseNumber} (數量: ${row[`fuse_${fuseNumber}`] || '空白'})`);
        continue;
      }

      const fuseid = fuseIdMap[fuseNumber];
      console.log(`處理 Fuse 編號: ${fuseNumber}, fuseid: ${fuseid}, 數量: ${quantity}`);

      // 針對 quantity 重複執行交易
      for (let i = 0; i < quantity; i++) {
        try {
          const currentGasPrice = readGasPriceFromFile(); // 讀取最新的 gasPrice
          const success = await sendTransaction(privateKey, fuseid, `Fuse ${fuseNumber}`, currentGasPrice); // 傳入金鑰、fuseid 和類型
          if (success) {
            console.log(`🗑️ 交易成功: ${privateKey}, Fuse ${fuseNumber}, 第 ${i + 1} 次`);
          } else {
            errorKeys.push(privateKey); // 將失敗的金鑰添加到列表中
          }
        } catch (error) {
          console.error(`❌ 交易失敗 (Fuse ${fuseNumber}, 第 ${i + 1} 次): ${error.message}`);
          errorKeys.push(privateKey); // 將失敗的金鑰添加到列表中
        }
        const delay = getRandomInterval(); // 隨機間隔等待
        console.log(`⏳ 等待 ${delay / 1000} 秒後繼續`);
        await new Promise((resolve) => setTimeout(resolve, delay)); // 隨機間隔等待
      }
    }
  }

  // 將失敗的金鑰輸出到文件中
  if (errorKeys.length > 0) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const errorFilePath = `errorkey_main_${timestamp}.txt`;
    fs.writeFileSync(errorFilePath, errorKeys.join('\n'), 'utf-8');
    console.log(`❌ 失敗的金鑰已輸出到文件: ${errorFilePath}`);
  }
}

if (isMainThread) {
  (async () => {
    try {
      const configData = await readConfigFromCSV();
      const configDataShuffled = shuffleArray(configData); // 打亂 config 數據
      const dataPerThread = Math.ceil(configDataShuffled.length / NUM_THREADS);

      for (let i = 0; i < NUM_THREADS; i++) {
        const start = i * dataPerThread;
        const end = start + dataPerThread;
        const workerData = configDataShuffled.slice(start, end);

        if (workerData.length > 0) {
          new Worker(__filename, { workerData });
        }
      }
    } catch (error) {
      console.error(`❌ 讀取 config.csv 失敗: ${error.message}`);
    }
  })();
} else {
  executeTransactions(workerData).catch(console.error);
}