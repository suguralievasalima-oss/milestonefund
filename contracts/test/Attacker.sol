// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMilestoneFund {
    function contribute(uint256 id) external payable;
    function refund(uint256 id) external;
}

/// @notice Тестовый контракт-злоумышленник: при получении ETH пытается
///         повторно вызвать refund (reentrancy-атака).
contract Attacker {
    IMilestoneFund public immutable fund;
    uint256 public campaignId;
    uint256 public reentryAttempts;
    bool public reentrySucceeded;

    constructor(address fund_) {
        fund = IMilestoneFund(fund_);
    }

    function invest(uint256 id) external payable {
        campaignId = id;
        fund.contribute{value: msg.value}(id);
    }

    function attack() external {
        fund.refund(campaignId);
    }

    receive() external payable {
        if (reentryAttempts == 0) {
            reentryAttempts++;
            // Повторный вызов должен провалиться (ReentrancyGuard);
            // ловим ошибку, чтобы зафиксировать результат попытки.
            try fund.refund(campaignId) {
                reentrySucceeded = true;
            } catch {}
        }
    }
}
