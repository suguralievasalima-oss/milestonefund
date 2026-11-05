# MilestoneFund

Milestone-based crowdfunding DApp. Funds are held by a smart contract and released to the creator
milestone by milestone, only after contributors approve each milestone in a stake-weighted vote.
If a milestone is rejected, contributors reclaim the unreleased funds pro rata.

## Features

- Many campaigns in one contract; each campaign has 1–10 milestones whose amounts sum to the goal
- Contributions only during the funding phase, so vote weights are frozen before any vote
- Stake-weighted voting with a 30% quorum and simple majority
- Full refund if the goal is not reached; proportional refund of the remainder if a milestone is rejected
- Reentrancy protection (OpenZeppelin `ReentrancyGuard` + checks-effects-interactions), custom errors
- React + ethers v6 frontend with MetaMask

## Stack

Solidity 0.8.24 · Hardhat 2 · OpenZeppelin 5 · Mocha/Chai · React 18 + Vite · ethers 6

## Quick start (Windows, PowerShell)

```powershell
npm install
cd frontend; npm install; cd ..
```

Terminal 1 — local blockchain:

```powershell
npx hardhat node
```

Terminal 2 — deploy and create demo campaigns (voting period on localhost = 5 minutes):

```powershell
npm run deploy:local
npm run seed:local
```

Terminal 3 — frontend:

```powershell
cd frontend
npm run dev
```

Open http://localhost:5173.

### MetaMask setup (local)

1. Add network: RPC `http://127.0.0.1:8545`, chain ID `31337`, symbol `ETH` (or press **Switch to Hardhat Local** in the app).
2. Import test accounts: copy private keys of `Account #0..#3` printed by `npx hardhat node`
   (these are public test keys — never use them on a real network).
3. After restarting the node: MetaMask → Settings → Advanced → **Clear activity tab data** (resets nonce).

### Skipping time (deadlines and voting)

```powershell
$env:ADVANCE_SECONDS="600"; npm run time:local
```

## Demo scenario

Seed creates campaign **#0** (Active, 10 ETH from accounts #1/#2/#3) and **#1** (Funding).

1. Account #0 (creator) opens #0 → **Start milestone vote**
2. Accounts #1 and #2 → **Approve**
3. Advance time 600 s → **Finalize vote** → creator **Withdraw milestone funds**
4. Next milestone: vote **Reject** → campaign Cancelled → investors **Refund** their share of the remainder

## Tests, coverage, gas

```powershell
npx hardhat test          # 40 tests
npx hardhat coverage      # MilestoneFund.sol: 100% statements / functions / lines
$env:REPORT_GAS="true"; npx hardhat test
```

Saved results: [docs/test-results.txt](docs/test-results.txt), [docs/coverage.txt](docs/coverage.txt),
[docs/gas-report.txt](docs/gas-report.txt).

## Sepolia deployment

1. Copy `.env.example` to `.env`, fill `SEPOLIA_RPC_URL`, `PRIVATE_KEY` (a separate test account!), `ETHERSCAN_API_KEY`, `VOTING_PERIOD` (e.g. `300`).
2. `npm run deploy:sepolia` — this also updates `frontend/src/contract/MilestoneFund.json`.
3. `npx hardhat verify --network sepolia <address> <votingPeriod>`

## Repository structure

```
contracts/MilestoneFund.sol      main contract
contracts/test/Attacker.sol      reentrancy attacker used in tests
test/MilestoneFund.test.js       test suite
scripts/                         deploy, seed, advance-time
frontend/                        React app
docs/                            test, coverage and gas results
```

## Authors

- [Name 1] — smart contract, tests, deployment
- [Name 2] — frontend, report, presentation
