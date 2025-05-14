import fs from 'fs';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { Worker, isMainThread, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config(); // 載入環境變數

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RPC_URL = 'https://rpc.soneium.org/';
const CONTRACT_ADDRESS = '0x80e041b16a38f4caa1d0137565b37fd71b2f1e2b'; // 目標合約地址
const GAS_PRICE_FILE = '/Users/chiatsetsai/Desktop/VSCODE3/1-Mithraeum/currentGasPrice.txt';
const NUM_THREADS = 28; // 設置線程數量

// 讀取 CSV 文件中的數據（包含表頭）
function readKeysFromCSV() {
    const data = fs.readFileSync('key.csv', 'utf-8');
    const lines = data.split('\n').map(line => line.trim()).filter(line => line !== '');

    // 解析表頭
    const headers = lines[0].split(',');
    const result = [];

    // 從第二行開始處理數據
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const entry = {};

        // 根據表頭名稱動態映射數據
        headers.forEach((header, index) => {
            entry[header] = values[index] || '';
        });

        // 確保包含必要的欄位
        if (entry.key && entry.OMASTR_times) {
            result.push({
                key: entry.key,
                OMASTR_times: parseInt(entry.OMASTR_times, 10)
            });
        }
    }

    return result;
}

// 隨機打亂數組
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// 隨機間隔，5 到 15 秒
function getRandomInterval() {
    return Math.floor(Math.random() * (5000 - 1000 + 1)) + 5000; // 5000 到 15000 毫秒
}

// 讀取最新的 gasPrice
function readGasPriceFromFile() {
    const gasPrice = fs.readFileSync(GAS_PRICE_FILE, 'utf-8');
    const gasPriceInGwei = parseFloat(gasPrice) / 1e9;
    return ethers.parseUnits(gasPriceInGwei.toString(), 'gwei');
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
async function sendTransaction(PRIVATE_KEY, gasPrice) {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log(`🟢 使用的 EVM 地址: ${wallet.address}`);

    // 將 receiver 設為當前錢包地址
    const receiver = wallet.address;

    // 構建 calldata
    const calldata = '0x2e748005000000000000000000000000' + receiver.slice(2);

    // 手動設置 gasLimit
    const gasLimit = 330276;

    // 發送交易
    const tx = await wallet.sendTransaction({
        to: CONTRACT_ADDRESS,
        data: calldata,
        gasLimit,
        gasPrice,
    });

    console.log(`📨 交易發送成功，交易哈希: ${tx.hash}`);

    // 等待交易確認
    try {
        const receipt = await waitForTransactionConfirmation(tx, 30000);
        console.log(`✅ 交易確認，區塊號: ${receipt.blockNumber}`);
        return true;
    } catch (error) {
        console.error(`⚠️ 交易未確認: ${error.message}`);
        fs.appendFileSync('error-script1.log', `${wallet.address}\n`);
        return false;
    }
}

// 執行所有交易
async function executeTransactions(entries) {
    entries = shuffleArray(entries); // 打亂數據順序

    const errorEntries = []; // 存儲失敗的記錄

    for (const entry of entries) {
        const { key, OMASTR_times } = entry;

        // 根據 OMASTR_times 執行交易
        for (let i = 0; i < OMASTR_times; i++) {
            try {
                const currentGasPrice = readGasPriceFromFile();
                const success = await sendTransaction(key,currentGasPrice);
                if (success) {
                    console.log(`🗑️ 交易成功: ${key} (OMASTR #${i + 1})`);
                } else {
                    errorEntries.push(entry);
                }
            } catch (error) {
                console.error(`❌ 交易失敗: ${key} (OMASTR #${i + 1}) - ${error.message}`);
                errorEntries.push(entry);
            }
            const delay = getRandomInterval();
            console.log(`⏳ 等待 ${delay / 1000} 秒後繼續`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // 將失敗的記錄輸出到文件中
    if (errorEntries.length > 0) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const errorFilePath = `errorkey_main_${timestamp}.txt`;
        const errorData = errorEntries.map(entry => entry.key).join('\n');
        fs.writeFileSync(errorFilePath, errorData, 'utf-8');
        console.log(`❌ 失敗的金鑰已輸出到文件: ${errorFilePath}`);
    }
}

if (isMainThread) {
    const entries = readKeysFromCSV();
    const entriesPerThread = Math.ceil(entries.length / NUM_THREADS);

    for (let i = 0; i < NUM_THREADS; i++) {
        const start = i * entriesPerThread;
        const end = start + entriesPerThread;
        const workerEntries = entries.slice(start, end);

        if (workerEntries.length > 0) {
            new Worker(__filename, { workerData: workerEntries });
        }
    }
} else {
    executeTransactions(workerData).catch(console.error);
}