import fs from 'fs';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { Worker, isMainThread, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';
import axios from 'axios'; // 用於 API 呼叫

dotenv.config(); // 載入環境變數

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RPC_URL = 'https://rpc.soneium.org/';
const CONTRACT_ADDRESS = '0x80e041b16a38f4caa1d0137565b37fd71b2f1e2b'; // 目標合約地址
const GAS_PRICE_FILE = '/Users/chiatsetsai/Desktop/VSCODE3/1-Mithraeum/currentGasPrice.txt';
const NUM_THREADS = 3; // 線程數量
const NUM_LOOPS = 1; // 每個帳號執行交易的次數
const API_URL = 'https://soneium.blockscout.com/api/v2/transactions/';

// 讀取 CSV 文件中的資料
function readDataFromCSV() {
    const data = fs.readFileSync('transfer_data.csv', 'utf-8');
    const lines = data.split('\n').map(line => line.trim()).filter(line => line !== '');
    const result = lines.slice(1).map(line => {
        const [privateKey, tokenId, amount, toAddress] = line.split(',');

        // 處理 tokenId
        let NFTID = parseInt(tokenId).toString(16); // 轉為16進制
        if (tokenId === '10') NFTID = 'a';
        else if (tokenId === '11') NFTID = 'b';
        else if (tokenId === '12') NFTID = 'c';
        
        // 處理 amount
        let formattedAmount = parseInt(amount).toString();
        formattedAmount = formattedAmount.padStart(2, '0'); // 補0至兩位數

        // 處理 toAddress
        const receiver = toAddress.startsWith('0x') ? toAddress.slice(2) : toAddress;

        return { privateKey, NFTID, amount: formattedAmount, receiver };
    });
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
    return Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000; // 5000 到 15000 毫秒
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
async function sendTransaction({ privateKey, NFTID, amount, receiver }, gasPrice) {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(privateKey, provider);

    console.log(`🟢 使用的 EVM 地址: ${wallet.address}`);

    // 構建 calldata
    const calldata =
        '0xf242432a' +
        '000000000000000000000000' + wallet.address.slice(2).toLowerCase() +
        '000000000000000000000000' +
        receiver +
        '000000000000000000000000000000000000000000000000000000000000000' + NFTID +
        '00000000000000000000000000000000000000000000000000000000000000' + amount +
        '00000000000000000000000000000000000000000000000000000000000000a0' +
        '0000000000000000000000000000000000000000000000000000000000000000';

    // 手動設置 gasLimit 和 gasPrice
    const gasLimit = 143493;

    // 發送交易
    const tx = await wallet.sendTransaction({
        to: CONTRACT_ADDRESS,
        data: calldata,
        gasLimit,
        gasPrice,
    });

    console.log(`   交易發送成功，交易哈希: ${tx.hash}`);

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
async function executeTransactions(data) {
    data = shuffleArray(data); // 打亂資料順序

    const errorData = []; // 存儲失敗的資料

    for (let i = 0; i < NUM_LOOPS; i++) {
        for (const item of data) {
            try {
                const currentGasPrice = readGasPriceFromFile();
                const success = await sendTransaction(item, currentGasPrice);
                if (success) {
                    console.log(`🗑️ 交易成功: ${item.privateKey}`);
                } else {
                    errorData.push(item);
                }
            } catch (error) {
                console.error(`❌ 交易失敗: ${error.message}`);
                errorData.push(item);
            }
            const delay = getRandomInterval();
            console.log(`⏳ 等待 ${delay / 1000} 秒後繼續`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // 將失敗的資料輸出到文件中
    if (errorData.length > 0) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const errorFilePath = `errorkey_main_${timestamp}.txt`;
        fs.writeFileSync(errorFilePath, errorData.map(item => item.privateKey).join('\n'), 'utf-8');
        console.log(`❌ 失敗的金鑰已輸出到文件: ${errorFilePath}`);
    }
}

if (isMainThread) {
    const data = readDataFromCSV();
    const dataPerThread = Math.ceil(data.length / NUM_THREADS);

    for (let i = 0; i < NUM_THREADS; i++) {
        const start = i * dataPerThread;
        const end = start + dataPerThread;
        const workerDataSlice = data.slice(start, end);

        if (workerDataSlice.length > 0) {
            new Worker(__filename, { workerData: workerDataSlice });
        }
    }
} else {
    executeTransactions(workerData).catch(console.error);
}