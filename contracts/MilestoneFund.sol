// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MilestoneFund — crowdfunding with milestone-based payouts
/// @notice Funds are held by the contract and released to the creator milestone by
///         milestone after a stake-weighted vote of the backers. If a milestone is
///         rejected, backers reclaim the remaining funds in proportion to their contributions.
contract MilestoneFund is ReentrancyGuard {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum CampaignState {
        Funding, // raising funds
        Active, // goal reached, milestones in progress
        Failed, // goal not reached by the deadline — full refunds
        Completed, // all milestones paid
        Cancelled // milestone rejected or campaign stalled — refunds of the remainder
    }

    enum MilestoneStatus {
        Pending,
        Voting,
        Approved,
        Rejected,
        Paid
    }

    struct Milestone {
        string description;
        uint256 amount;
        uint64 voteEnd;
        uint256 yesWeight;
        uint256 noWeight;
        MilestoneStatus status;
    }

    struct Campaign {
        address creator;
        string title;
        uint256 goal;
        uint64 deadline;
        uint256 totalRaised;
        uint256 released;
        uint64 lastProgress; // start of the submission deadline for the current milestone
        uint32 milestoneCount;
        uint32 currentMilestone;
        CampaignState state;
    }

    // ---------------------------------------------------------------------
    // Constants and storage
    // ---------------------------------------------------------------------

    /// @notice Minimum turnout: share (in %) of the outside stake that must vote
    uint256 public constant QUORUM_PERCENT = 30;
    uint256 public constant MAX_MILESTONES = 10;

    /// @notice Length of a milestone vote in seconds, set at deployment
    uint256 public immutable votingPeriod;

    /// @notice Time in seconds the creator has to submit the current milestone for a
    ///         vote. If the deadline is missed, anyone can cancel the campaign and
    ///         backers reclaim the remainder, so funds never get stuck in the contract.
    uint256 public immutable submissionPeriod;

    Campaign[] private _campaigns;
    mapping(uint256 => mapping(uint256 => Milestone)) private _milestones;
    mapping(uint256 => mapping(address => uint256)) private _contributions;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) private _hasVoted;
    mapping(uint256 => mapping(address => bool)) private _refunded;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event CampaignCreated(uint256 indexed id, address indexed creator, string title, uint256 goal, uint256 deadline);
    event Contributed(uint256 indexed id, address indexed investor, uint256 amount);
    event FundingFinalized(uint256 indexed id, bool success, uint256 totalRaised);
    event VoteStarted(uint256 indexed id, uint256 indexed milestone, uint256 voteEnd);
    event Voted(uint256 indexed id, uint256 indexed milestone, address indexed voter, bool approve, uint256 weight);
    event MilestoneFinalized(uint256 indexed id, uint256 indexed milestone, bool approved, uint256 yesWeight, uint256 noWeight);
    event MilestoneWithdrawn(uint256 indexed id, uint256 indexed milestone, uint256 amount);
    event Refunded(uint256 indexed id, address indexed investor, uint256 amount);
    event CampaignStalled(uint256 indexed id, uint256 indexed milestone);

    // ---------------------------------------------------------------------
    // Errors (cheaper in gas than revert strings)
    // ---------------------------------------------------------------------

    error InvalidMilestones();
    error InvalidGoal();
    error InvalidDuration();
    error CampaignNotFound();
    error WrongCampaignState();
    error WrongMilestoneStatus();
    error DeadlinePassed();
    error DeadlineNotReached();
    error ZeroContribution();
    error NotCreator();
    error NotInvestor();
    error AlreadyVoted();
    error VotingClosed();
    error VotingNotEnded();
    error NothingToRefund();
    error TransferFailed();
    error CreatorCannotVote();
    error NotStalled();

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier exists(uint256 id) {
        if (id >= _campaigns.length) revert CampaignNotFound();
        _;
    }

    modifier onlyCreator(uint256 id) {
        if (msg.sender != _campaigns[id].creator) revert NotCreator();
        _;
    }

    modifier inState(uint256 id, CampaignState s) {
        if (_campaigns[id].state != s) revert WrongCampaignState();
        _;
    }

    /// @param votingPeriod_ vote length in seconds (e.g. 3 days; 5 minutes for a demo)
    /// @param submissionPeriod_ deadline for submitting each milestone for a vote (e.g. 30 days)
    constructor(uint256 votingPeriod_, uint256 submissionPeriod_) {
        if (votingPeriod_ == 0 || submissionPeriod_ == 0) revert InvalidDuration();
        votingPeriod = votingPeriod_;
        submissionPeriod = submissionPeriod_;
    }

    // ---------------------------------------------------------------------
    // Campaign creation and funding
    // ---------------------------------------------------------------------

    /// @notice Creates a campaign. Milestone amounts must add up to the goal.
    /// @return id the new campaign's identifier
    function createCampaign(
        string calldata title,
        uint256 goal,
        uint256 durationSeconds,
        string[] calldata descriptions,
        uint256[] calldata amounts
    ) external returns (uint256 id) {
        uint256 n = amounts.length;
        if (n == 0 || n > MAX_MILESTONES || n != descriptions.length) revert InvalidMilestones();
        if (goal == 0) revert InvalidGoal();
        if (durationSeconds == 0) revert InvalidDuration();

        id = _campaigns.length;
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            if (amounts[i] == 0) revert InvalidMilestones();
            sum += amounts[i];
            Milestone storage m = _milestones[id][i];
            m.description = descriptions[i];
            m.amount = amounts[i];
        }
        if (sum != goal) revert InvalidMilestones();

        uint64 deadline = uint64(block.timestamp + durationSeconds);
        _campaigns.push(
            Campaign({
                creator: msg.sender,
                title: title,
                goal: goal,
                deadline: deadline,
                totalRaised: 0,
                released: 0,
                lastProgress: 0,
                milestoneCount: uint32(n),
                currentMilestone: 0,
                state: CampaignState.Funding
            })
        );
        emit CampaignCreated(id, msg.sender, title, goal, deadline);
    }

    /// @notice Contributes to a campaign. Only possible while funding.
    /// @dev Contributions are accepted ONLY in the Funding state and votes start only
    ///      in Active, so vote weights are fixed before any vote. This prevents
    ///      buying voting power right before a vote.
    function contribute(uint256 id) external payable exists(id) inState(id, CampaignState.Funding) {
        Campaign storage c = _campaigns[id];
        if (block.timestamp >= c.deadline) revert DeadlinePassed();
        if (msg.value == 0) revert ZeroContribution();
        c.totalRaised += msg.value;
        _contributions[id][msg.sender] += msg.value;
        emit Contributed(id, msg.sender, msg.value);
    }

    /// @notice Ends funding: after the deadline, or early once the goal is reached.
    function finalizeFunding(uint256 id) external exists(id) inState(id, CampaignState.Funding) {
        Campaign storage c = _campaigns[id];
        bool reached = c.totalRaised >= c.goal;
        if (!reached && block.timestamp < c.deadline) revert DeadlineNotReached();
        c.state = reached ? CampaignState.Active : CampaignState.Failed;
        c.lastProgress = uint64(block.timestamp);
        emit FundingFinalized(id, reached, c.totalRaised);
    }

    // ---------------------------------------------------------------------
    // Milestone voting
    // ---------------------------------------------------------------------

    /// @notice The creator reports the current milestone as done and opens a vote.
    function startMilestoneVote(uint256 id)
        external
        exists(id)
        onlyCreator(id)
        inState(id, CampaignState.Active)
    {
        Campaign storage c = _campaigns[id];
        Milestone storage m = _milestones[id][c.currentMilestone];
        if (m.status != MilestoneStatus.Pending) revert WrongMilestoneStatus();
        m.status = MilestoneStatus.Voting;
        m.voteEnd = uint64(block.timestamp + votingPeriod);
        emit VoteStarted(id, c.currentMilestone, m.voteEnd);
    }

    /// @notice A backer's vote on the current milestone, weighted by the contribution.
    ///         The creator cannot vote on their own milestones, even after contributing.
    function vote(uint256 id, bool approve) external exists(id) inState(id, CampaignState.Active) {
        Campaign storage c = _campaigns[id];
        uint256 idx = c.currentMilestone;
        Milestone storage m = _milestones[id][idx];
        if (m.status != MilestoneStatus.Voting) revert WrongMilestoneStatus();
        if (block.timestamp >= m.voteEnd) revert VotingClosed();
        if (msg.sender == c.creator) revert CreatorCannotVote();
        uint256 weight = _contributions[id][msg.sender];
        if (weight == 0) revert NotInvestor();
        if (_hasVoted[id][idx][msg.sender]) revert AlreadyVoted();

        _hasVoted[id][idx][msg.sender] = true;
        if (approve) m.yesWeight += weight;
        else m.noWeight += weight;
        emit Voted(id, idx, msg.sender, approve, weight);
    }

    /// @notice Closes a vote. The milestone is approved if turnout >= QUORUM_PERCENT of
    ///         the voting stake (raised minus the creator's contribution) and Yes outweighs
    ///         No. Otherwise the campaign is cancelled and refunds open.
    function finalizeMilestone(uint256 id) external exists(id) inState(id, CampaignState.Active) {
        Campaign storage c = _campaigns[id];
        uint256 idx = c.currentMilestone;
        Milestone storage m = _milestones[id][idx];
        if (m.status != MilestoneStatus.Voting) revert WrongMilestoneStatus();
        if (block.timestamp < m.voteEnd) revert VotingNotEnded();

        uint256 votingStake = c.totalRaised - _contributions[id][c.creator];
        bool quorum = votingStake > 0 && (m.yesWeight + m.noWeight) * 100 >= votingStake * QUORUM_PERCENT;
        bool approved = quorum && m.yesWeight > m.noWeight;
        if (approved) {
            m.status = MilestoneStatus.Approved;
        } else {
            m.status = MilestoneStatus.Rejected;
            c.state = CampaignState.Cancelled;
        }
        emit MilestoneFinalized(id, idx, approved, m.yesWeight, m.noWeight);
    }

    // ---------------------------------------------------------------------
    // Payouts and refunds
    // ---------------------------------------------------------------------

    /// @notice The creator withdraws an approved milestone. Any amount raised above
    ///         the goal is paid out with the last milestone.
    function withdrawMilestone(uint256 id)
        external
        nonReentrant
        exists(id)
        onlyCreator(id)
        inState(id, CampaignState.Active)
    {
        Campaign storage c = _campaigns[id];
        uint256 idx = c.currentMilestone;
        Milestone storage m = _milestones[id][idx];
        if (m.status != MilestoneStatus.Approved) revert WrongMilestoneStatus();

        // checks-effects-interactions: update state first, then transfer ETH
        uint256 payout = m.amount;
        if (idx + 1 == c.milestoneCount) payout += c.totalRaised - c.goal;
        m.status = MilestoneStatus.Paid;
        c.released += payout;
        c.currentMilestone = uint32(idx + 1);
        c.lastProgress = uint64(block.timestamp);
        if (idx + 1 == c.milestoneCount) c.state = CampaignState.Completed;

        emit MilestoneWithdrawn(id, idx, payout);
        _send(c.creator, payout);
    }

    /// @notice Cancels a campaign whose creator did not submit the current milestone
    ///         within submissionPeriod. Callable by anyone. Backers then reclaim the
    ///         unreleased funds through refund().
    function cancelStalled(uint256 id) external exists(id) inState(id, CampaignState.Active) {
        Campaign storage c = _campaigns[id];
        uint256 idx = c.currentMilestone;
        if (_milestones[id][idx].status != MilestoneStatus.Pending) revert WrongMilestoneStatus();
        if (block.timestamp < c.lastProgress + submissionPeriod) revert NotStalled();
        c.state = CampaignState.Cancelled;
        emit CampaignStalled(id, idx);
    }

    /// @notice Refunds a backer.
    ///         Failed: the full contribution; Cancelled: a share of the unreleased funds:
    ///         contribution * (totalRaised - released) / totalRaised.
    function refund(uint256 id) external nonReentrant exists(id) {
        Campaign storage c = _campaigns[id];
        uint256 contribution = _contributions[id][msg.sender];
        if (contribution == 0 || _refunded[id][msg.sender]) revert NothingToRefund();

        uint256 amount;
        if (c.state == CampaignState.Failed) {
            amount = contribution;
        } else if (c.state == CampaignState.Cancelled) {
            amount = (contribution * (c.totalRaised - c.released)) / c.totalRaised;
        } else {
            revert WrongCampaignState();
        }

        _refunded[id][msg.sender] = true;
        emit Refunded(id, msg.sender, amount);
        _send(msg.sender, amount);
    }

    function _send(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ---------------------------------------------------------------------
    // View functions
    // ---------------------------------------------------------------------

    function campaignCount() external view returns (uint256) {
        return _campaigns.length;
    }

    function getCampaign(uint256 id) external view exists(id) returns (Campaign memory) {
        return _campaigns[id];
    }

    function getMilestone(uint256 id, uint256 index) external view exists(id) returns (Milestone memory) {
        if (index >= _campaigns[id].milestoneCount) revert InvalidMilestones();
        return _milestones[id][index];
    }

    function getContribution(uint256 id, address investor) external view returns (uint256) {
        return _contributions[id][investor];
    }

    function hasVotedOn(uint256 id, uint256 index, address voter) external view returns (bool) {
        return _hasVoted[id][index][voter];
    }

    function isRefunded(uint256 id, address investor) external view returns (bool) {
        return _refunded[id][investor];
    }
}
