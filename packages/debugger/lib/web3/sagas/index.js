import debugModule from "debug";
const debug = debugModule("debugger:web3:sagas");

import {
  all,
  takeEvery,
  apply,
  fork,
  join,
  take,
  put,
  race,
  call
} from "redux-saga/effects";
import { prefixName } from "lib/helpers";

import * as actions from "../actions";
import * as session from "lib/session/actions";

import BN from "bn.js";
import Web3 from "web3"; //just for utils!
import * as Codec from "@truffle/codec";

import Web3Adapter from "../adapter";

//the following two functions are for Besu compatibility
function padStackAndMemory(steps) {
  return steps.map(step => ({
    ...step,
    stack: step.stack.map(padHexString),
    memory: step.memory.map(padHexString)
  }));
}

//turns Besu-style (begins with 0x, may be shorter than 64 hexdigits)
//to Geth/Ganache-style (no 0x, always 64 hexdigits)
//(I say 64 hexdigits rather than 32 bytes because Besu-style will use
//non-whole numbers of bytes!)
function padHexString(hexString) {
  return hexString.startsWith("0x") //Besu-style or Geth/Ganache-style?
    ? hexString.slice(2).padStart(2 * Codec.Evm.Utils.WORD_SIZE, "0") //convert Besu to Geth/Ganache
    : hexString; //leave Geth/Ganache style alone
}

function* fetchTransactionInfo(adapter, { txHash }) {
  debug("inspecting transaction");
  var trace;
  try {
    trace = yield apply(adapter, adapter.getTrace, [txHash]);
  } catch (e) {
    debug("putting error");
    yield put(actions.error(e));
    return;
  }

  debug("got trace");
  trace = padStackAndMemory(trace); //for Besu compatibility
  yield put(actions.receiveTrace(trace));

  const tx = yield apply(adapter, adapter.getTransaction, [txHash]);
  debug("tx %O", tx);
  const receipt = yield apply(adapter, adapter.getReceipt, [txHash]);
  debug("receipt %O", receipt);
  const block = yield apply(adapter, adapter.getBlock, [tx.blockNumber]);
  debug("block %O", block);
  const chainId = yield apply(adapter, adapter.getChainId);

  yield put(session.saveTransaction(tx));
  yield put(session.saveReceipt(receipt));
  yield put(session.saveBlock(block));

  //these ones get grouped together for convenience
  const solidityBlock = {
    coinbase: block.miner,
    difficulty: new BN(block.difficulty),
    gaslimit: new BN(block.gasLimit),
    number: new BN(block.number),
    timestamp: new BN(block.timestamp),
    chainid: new BN(chainId), //key is lowercase because that's what Solidity does
    basefee: new BN(parseInt(block.baseFeePerGas)) //will be 0 if pre-London [new BN(NaN) yields 0]
    //note we need parseInt on basefee because some web3 versions return it as a hex string,
    //and BN doesn't allow for hex strings as input
  };

  if (tx.to != null) {
    yield put(
      actions.receiveCall({
        address: tx.to,
        data: tx.input,
        storageAddress: tx.to,
        status: receipt.status,
        sender: tx.from,
        value: new BN(tx.value),
        gasprice: new BN(tx.gasPrice),
        block: solidityBlock,
        blockHash: block.hash,
        txIndex: tx.transactionIndex
      })
    );
  } else {
    const storageAddress = Web3.utils.isAddress(receipt.contractAddress)
      ? receipt.contractAddress
      : Codec.Evm.Utils.ZERO_ADDRESS;
    yield put(
      actions.receiveCall({
        binary: tx.input,
        storageAddress,
        status: receipt.status,
        sender: tx.from,
        value: new BN(tx.value),
        gasprice: new BN(tx.gasPrice),
        block: solidityBlock,
        blockHash: block.hash,
        txIndex: tx.transactionIndex
      })
    );
  }
}

export function* inspectTransaction(txHash) {
  yield put(actions.inspect(txHash));

  let action = yield take([actions.RECEIVE_TRACE, actions.ERROR_WEB3]);
  debug("action %o", action);

  var trace;
  if (action.type == actions.RECEIVE_TRACE) {
    trace = action.trace;
    debug("received trace");
  } else {
    return { error: action.error };
  }

  let {
    address,
    binary,
    data,
    storageAddress,
    status,
    sender,
    value,
    gasprice,
    block,
    blockHash,
    txIndex
  } = yield take(actions.RECEIVE_CALL);
  debug("received call");

  return {
    trace,
    address,
    binary,
    data,
    storageAddress,
    status,
    sender,
    value,
    gasprice,
    block,
    blockHash,
    txIndex
  };
}

//NOTE: the block argument is optional
export function* obtainBinaries(addresses, block) {
  let tasks = yield all(addresses.map(address => fork(receiveBinary, address)));

  debug("requesting binaries");
  yield all(addresses.map(address => put(actions.fetchBinary(address, block))));

  let binaries = [];
  binaries = yield join(tasks);

  debug("binaries %o", binaries);

  return binaries;
}

function* fetchBinary(adapter, { address, block }) {
  debug("fetching binary for %s", address);
  let binary = yield apply(adapter, adapter.getDeployedCode, [address, block]);

  debug("received binary for %s", address);
  yield put(actions.receiveBinary(address, binary));
}

function* receiveBinary(address) {
  let { binary } = yield take(
    action => action.type == actions.RECEIVE_BINARY && action.address == address
  );
  debug("got binary for %s", address);

  return binary;
}

export function* obtainStorage(address, slot, blockHash, txIndex) {
  debug("forking");
  const task = yield fork(function* () {
    return yield race({
      success: call(receiveStorage, address, slot),
      failure: call(receiveStorageErrorHandler)
    });
  });
  yield put(actions.fetchStorage(address, slot, blockHash, txIndex));
  debug("joining");
  const result = yield join(task);
  debug("result: %O", result);
  if (result.failure) {
    throw result.failure;
  } else {
    return result.success;
  }
}

function* fetchStorage(adapter, { address, slot, blockHash, txIndex }) {
  const slotAsHex = Codec.Conversion.toHexString(
    slot,
    Codec.Evm.Utils.WORD_SIZE
  );
  try {
    const word = yield apply(adapter, adapter.getExistingStorage, [
      address,
      slotAsHex,
      blockHash,
      txIndex
    ]);
    yield put(actions.receiveStorage(address, slot, word));
  } catch (error) {
    yield put(actions.receiveStorageFail(error));
  }
}

function* receiveStorage(address, slot) {
  const { word } = yield take(
    action =>
      action.type == actions.RECEIVE_STORAGE &&
      action.address == address &&
      action.slot.eq(slot) //remember, these are BNs
  );
  return word;
}

function* receiveStorageErrorHandler() {
  const { error } = yield take(actions.RECEIVE_STORAGE_FAIL);
  return error; //because this is forked, we need to return
  //rather than throw to prevent redux-saga from giving up
}

export function* init(provider) {
  yield put(actions.init(provider));
}

export function* saga() {
  // wait for web3 init signal
  let { provider } = yield take(actions.INIT_WEB3);
  let adapter = new Web3Adapter(provider);

  yield takeEvery(actions.INSPECT, fetchTransactionInfo, adapter);
  yield takeEvery(actions.FETCH_BINARY, fetchBinary, adapter);
  yield takeEvery(actions.FETCH_STORAGE, fetchStorage, adapter);
}

export default prefixName("web3", saga);
