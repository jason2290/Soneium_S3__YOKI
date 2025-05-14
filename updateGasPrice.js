import fs from 'fs';
import axios from 'axios';
import { ethers } from 'ethers';

const GAS_PRICE_FILE = './currentGasPrice.txt';

async function fetchGasPrice() {
    try {
        const response = await axios.get("https://soneium.blockscout.com/api/v2/main-page/blocks");
        if (response.status === 200) {
            const data = response.data;
            const baseFees = data.map(block => parseInt(block.base_fee_per_gas));
            let minBaseFee = Math.min(...baseFees);

            let previousGasPrice = 0;
            if (fs.existsSync(GAS_PRICE_FILE)) {
                previousGasPrice = parseInt(fs.readFileSync(GAS_PRICE_FILE, 'utf-8'));
            }

            let multiplier = 1.1;
            if (previousGasPrice > 0) {
                const percentageIncrease = ((minBaseFee - previousGasPrice) / previousGasPrice) * 100;
                if (percentageIncrease > 0.5) {
                    multiplier += Math.floor(percentageIncrease / 0.5) * 0.05;
                }
            }

            const currentGasPrice = Math.max(Math.ceil(minBaseFee * multiplier), 1000);
            fs.writeFileSync(GAS_PRICE_FILE, currentGasPrice.toString());
            console.log(`更新 gasPrice: ${currentGasPrice}, 倍數: ${multiplier}`);
        } else {
            console.error("Gas price fetch failed, using previous value.");
        }
    } catch (error) {
        console.error("Gas price fetch failed, using previous value.", error);
    }
}

// 每 10 秒更新一次 gasPrice
setInterval(fetchGasPrice, 5000);

// 初始執行一次
fetchGasPrice();