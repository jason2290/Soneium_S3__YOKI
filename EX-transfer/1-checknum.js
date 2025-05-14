import fs from 'fs/promises';
import Papa from 'papaparse';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RPC_URL = 'https://rpc.soneium.org/';
const CONTRACT_ADDRESS = '0x80E041b16a38f4caa1d0137565B37FD71b2f1E2b';
const capsuleIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// 查詢 ERC-1155 數據
async function fetchERC1155Data(walletAddress) {
    const url = `https://soneium.blockscout.com/api/v2/addresses/${walletAddress}/tokens?type=ERC-1155`;
    try {
        const response = await fetch(url, { timeout: 5000 });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const result = {};
        capsuleIds.forEach(id => {
            result[id] = 0;
        });
        data.items.forEach(item => {
            if (item.token.address.toLowerCase() === CONTRACT_ADDRESS.toLowerCase()) {
                const tokenId = parseInt(item.token_id);
                if (capsuleIds.includes(tokenId)) {
                    result[tokenId] = parseInt(item.value);
                }
            }
        });
        return result;
    } catch (error) {
        console.error(`獲取 ${walletAddress} 的 Capsule 數據失敗:`, error);
        return null;
    }
}

// 從 CSV 讀取查詢地址和私鑰
async function readAddressesFromCSV(filePath) {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const results = Papa.parse(fileContent, { header: true, skipEmptyLines: true });
    if (results.errors.length > 0) {
        throw new Error(`解析 ${filePath} 失敗: ${results.errors[0].message}`);
    }
    const entries = results.data
        .map(row => ({
            address: row.address?.trim().toLowerCase(),
            key: row.key?.trim()
        }))
        .filter(entry => entry.address && entry.key && /^0x[a-fA-F0-9]{40}$/.test(entry.address) && /^0x[a-fA-F0-9]{64}$/.test(entry.key));
    if (entries.length === 0) {
        throw new Error(`${filePath} 中沒有有效地址或私鑰`);
    }
    return entries;
}

// 收集代幣數據並拆分數量
async function collectAndSplitTokenData(entries) {
    const tokenData = [];
    const batchSize = 10;

    for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        const fetchPromises = batch.map(async entry => {
            const data = await fetchERC1155Data(entry.address);
            if (data) {
                // 為每個 tokenId 拆分數量
                capsuleIds.forEach(tokenId => {
                    let amount = data[tokenId];
                    if (amount > 0) {
                        // 拆分數量，每行最多 4 個
                        while (amount > 0) {
                            const splitAmount = Math.min(amount, 4);
                            tokenData.push({
                                privateKey: entry.key,
                                tokenId,
                                amount: splitAmount
                            });
                            amount -= splitAmount;
                        }
                    }
                });
            }
        });
        await Promise.all(fetchPromises);
    }

    return tokenData;
}

// 保存結果到 CSV
async function saveTokenDataToCSV(tokenData) {
    const headers = ['privateKey', 'tokenId', 'amount'];
    const rows = tokenData.map(data => [
        data.privateKey,
        data.tokenId,
        data.amount
    ]);
    const csvContent = Papa.unparse([headers, ...rows]);
    await fs.writeFile('token_balances.csv', csvContent);
    console.log('代幣數量已保存到 token_balances.csv');
}

// 主函數
async function main() {
    try {
        const entries = await readAddressesFromCSV('query_addresses.csv');
        console.log(`查詢地址數量: ${entries.length}`);

        const tokenData = await collectAndSplitTokenData(entries);
        console.log(`總共生成 ${tokenData.length} 筆代幣記錄`);

        if (tokenData.length === 0) {
            console.error('沒有查詢到任何代幣數據');
            return;
        }

        await saveTokenDataToCSV(tokenData);
    } catch (error) {
        console.error('執行失敗:', error.message);
    }
}

// 執行主函數
main().catch(console.error);