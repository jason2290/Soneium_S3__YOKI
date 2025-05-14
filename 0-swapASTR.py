from web3 import Web3
import requests
import csv
import random
import time
from concurrent.futures import ThreadPoolExecutor

# RPC & 合約地址
RPC_URL = "https://rpc.soneium.org/"
SWAP_CONTRACT = Web3.to_checksum_address("0xeba58c20629ddab41e21a3e4e2422e583ebd9719")
TOKEN_ETH = Web3.to_checksum_address("0x4200000000000000000000000000000000000006")
TOKEN_ASTAR = Web3.to_checksum_address("0x2CAE934a1e84F693fbb78CA5ED3B0A6893259441")
GAS_PRICE_FILE = "/Users/chiatsetsai/Desktop/VSCODE3/1-Mithraeum/currentGasPrice.txt"
GAS_LIMIT = 380000  # 固定 gas limit 為 380000

# 連接 Web3
web3 = Web3(Web3.HTTPProvider(RPC_URL))
if not web3.is_connected():
    raise Exception("無法連接到 RPC")

# 讀取最新的 gasPrice
def read_gas_price_from_file():
    try:
        with open(GAS_PRICE_FILE, 'r') as f:
            gas_price = float(f.read().strip()) / 1e9
            return web3.to_wei(gas_price, 'gwei')
    except Exception as e:
        print(f"無法讀取 gas 價格文件，使用默認值: {e}")
        return web3.eth.gas_price

# 獲取 token 價格
def get_token_price(token_address):
    url = f"https://leaderboard.quickswap.exchange/utils/token-prices/v3?chainId=1868&addresses={token_address}"
    response = requests.get(url)
    data = response.json()
    if data["status"] == 200 and data["data"]:
        print(f"獲取價格: {data['data'][0]['price']}")
        return float(data["data"][0]["price"])
        
    return None

# 構造合約 ABI
abi = [{
    "constant": False,
    "inputs": [{"components": [
        {"name": "tokenIn", "type": "address"},
        {"name": "tokenOut", "type": "address"},
        {"name": "deployer", "type": "address"},
        {"name": "recipient", "type": "address"},
        {"name": "deadline", "type": "uint256"},
        {"name": "amountIn", "type": "uint256"},
        {"name": "amountOutMinimum", "type": "uint256"},
        {"name": "limitSqrtPrice", "type": "uint160"}
    ], "name": "params", "type": "tuple"}],
    "name": "exactInputSingle",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
}]

swap_contract = web3.eth.contract(address=SWAP_CONTRACT, abi=abi)

# 從 CSV 讀取金鑰
def load_keys_from_csv(file_path):
    keys = []
    try:
        with open(file_path, mode='r') as file:
            reader = csv.DictReader(file)
            # Check if required fields exist
            if 'address' not in reader.fieldnames or 'private_key' not in reader.fieldnames:
                raise ValueError("CSV file must contain 'address' and 'private_key' columns")
            
            for row in reader:
                keys.append({
                    "address": row["address"],
                    "private_key": row["private_key"]
                })
        return keys
    except FileNotFoundError:
        print(f"Error: Could not find file {file_path}")
        return []
    except Exception as e:
        print(f"Error reading CSV: {str(e)}")
        return []

# 將失敗地址寫入 error.csv
def log_failed_address(wallet_address):
    file_exists = False
    try:
        with open("error.csv", "r"):
            file_exists = True
    except FileNotFoundError:
        file_exists = False

    with open("error.csv", mode='a', newline='') as file:
        writer = csv.writer(file)
        if not file_exists:
            writer.writerow(["address"])
        writer.writerow([wallet_address])

# 隨機間隔，1到3秒
def get_random_interval():
    return random.uniform(1, 3)

# 執行單個交易
def execute_swap(wallet):
    try:
        WALLET_ADDRESS = wallet["address"]
        PRIVATE_KEY = wallet["private_key"]

        print(f"🟢 處理地址: {WALLET_ADDRESS}")
        amount_in_eth = random.uniform(0.00015, 0.00025)
        print(f"使用隨機金額: {amount_in_eth} ETH")

        # 更新匯率
        eth_price = get_token_price(TOKEN_ETH)
        astar_price = get_token_price(TOKEN_ASTAR)
        if eth_price is None or astar_price is None:
            print(f"獲取價格失敗，跳過交易")
            return

        # 獲取當前 gas 價格
        gas_price = read_gas_price_from_file()
        print(f"當前 gas 價格: {web3.from_wei(gas_price, 'gwei')} gwei")

        balance = web3.eth.get_balance(WALLET_ADDRESS)
        amount_in_wei = web3.to_wei(amount_in_eth, "ether")
        amount_out_min = int(amount_in_wei * eth_price / astar_price * 0.97)

        params = (
            TOKEN_ETH,
            TOKEN_ASTAR,
            Web3.to_checksum_address("0x0000000000000000000000000000000000000000"),
            WALLET_ADDRESS,
            web3.eth.get_block("latest")["timestamp"] + 600,
            amount_in_wei,
            amount_out_min,
            0
        )

        # 使用固定 gas limit 380000
        total_cost = amount_in_wei + GAS_LIMIT * gas_price
        if balance < total_cost:
            print(f"餘額不足: {web3.from_wei(balance, 'ether')} ETH")
            return

        nonce = web3.eth.get_transaction_count(WALLET_ADDRESS)
        tx = swap_contract.functions.exactInputSingle(params).build_transaction({
            "from": WALLET_ADDRESS,
            "value": amount_in_wei,
            "gas": GAS_LIMIT,  # 固定為 380000
            "gasPrice": gas_price,
            "nonce": nonce
        })

        signed_tx = web3.eth.account.sign_transaction(tx, PRIVATE_KEY)
        tx_hash = web3.eth.send_raw_transaction(signed_tx.rawTransaction)
        print(f"📨 交易已發送，TX Hash: {tx_hash.hex()}")

        receipt = web3.eth.wait_for_transaction_receipt(tx_hash, timeout=30)
        if receipt["status"] == 1:
            print(f"✅ 交易成功！塊號: {receipt['blockNumber']}")
        else:
            print(f"⚠️ 交易失敗！TX Hash: {tx_hash.hex()}")
            log_failed_address(WALLET_ADDRESS)

        delay = get_random_interval()
        print(f"⏳ 等待 {delay:.2f} 秒")
        time.sleep(delay)

    except Exception as e:
        print(f"❌ 交易處理失敗: {str(e)}")
        log_failed_address(WALLET_ADDRESS)

# 多線程執行
def run_swaps_in_threads(keys, max_workers=20):
    random.shuffle(keys)
    print("錢包順序已隨機打亂")
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        executor.map(execute_swap, keys)
    
    print("所有交易已完成！")

if __name__ == "__main__":
    keys = load_keys_from_csv("keyASTR.csv")
    print(f"已載入 {len(keys)} 個錢包")
    run_swaps_in_threads(keys, max_workers=7)