import fs from 'fs';
import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

const GAS_PRICE_FILE = '/Users/chiatsetsai/Desktop/VSCODE3/1-Mithraeum/currentGasPrice.txt';
const RPC_URL = 'https://rpc.soneium.org/';
const CONTRACT_ADDRESS = '0x2CAE934a1e84F693fbb78CA5ED3B0A6893259441'; // 目標合約地址

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
        if (entry.key) {
            result.push(entry.key);
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

// 隨機間隔，1到3秒
function getRandomInterval() {
    return Math.floor(Math.random() * 3) + 1;
}

// 讀取最新的 gasPrice
function readGasPriceFromFile() {
    const gasPrice = fs.readFileSync(GAS_PRICE_FILE, 'utf-8');
    const gasPriceInGwei = parseFloat(gasPrice) / 1e9;
    return ethers.parseUnits(gasPriceInGwei.toString(), 'gwei');
}

// 發送交易
async function sendTransaction(PRIVATE_KEY, gasPrice) {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

    console.log(`🟢 使用的 EVM 地址: ${wallet.address}`);
    const calldata = '0x095ea7b300000000000000000000000080e041b16a38f4caa1d0137565b37fd71b2f1e2b000000000000000000000000000000000000000000000015af1d78b58c400000';
    const gasLimit = 155175;

    const tx = await wallet.sendTransaction({
        to: CONTRACT_ADDRESS,
        data: calldata,
        gasLimit,
        gasPrice,
    });

    console.log(`📨 交易發送成功，交易哈希: ${tx.hash}`);

    try {
        const receipt = await waitForTransactionConfirmation(tx, 30000);
        console.log(`✅ 交易確認，區塊號: ${receipt.blockNumber}`);
    } catch (error) {
        console.error(`⚠️ 交易未確認: ${error.message}`);
        fs.appendFileSync('error-log.txt', `${wallet.address}\n`);
    }
}

// 等待交易確認
async function waitForTransactionConfirmation(tx, timeout = 30000) {
    return Promise.race([
        tx.wait(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`交易 ${tx.hash} 在 ${timeout / 1000} 秒內未確認成功`)), timeout))
    ]);
}

// Promise 池實現
async function promisePool(tasks, concurrency) {
    const results = [];
    const executing = new Set();

    for (const task of tasks) {
        const promise = task().then(result => {
            executing.delete(promise);
            return result;
        }).catch(err => {
            executing.delete(promise);
            throw err;
        });

        executing.add(promise);
        results.push(promise);

        if (executing.size >= concurrency) {
            await Promise.race(executing);
        }
    }

    return Promise.all(results);
}

// 執行所有交易
async function executeTransactions() {
    let keys = readKeysFromCSV();
    keys = shuffleArray(keys);

    const tasks = keys.map(privateKey => async () => {
        try {
            const currentGasPrice = readGasPriceFromFile();
            await sendTransaction(privateKey, currentGasPrice);
        } catch (error) {
            console.error(`❌ 交易失敗: ${error.message}`);
        }
        const delay = getRandomInterval() * 1000;
        console.log(`⏳ 等待 ${delay / 1000} 秒後繼續`);
        await new Promise(resolve => setTimeout(resolve, delay));
    });

    // 使用 Promise 池，限制並行數量為 20
    await promisePool(tasks, 5);
    console.log('所有交易已完成！');
}

// 執行交易
executeTransactions().catch(console.error);