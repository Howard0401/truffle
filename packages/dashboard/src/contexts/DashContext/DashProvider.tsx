import { useReducer, useEffect } from "react";
import { useDidUpdate } from "@mantine/hooks";
import { useAccount, useProvider, useNetwork } from "wagmi";
import type { providers } from "ethers";
import { DashboardMessageBusClient } from "@truffle/dashboard-message-bus-client";
import type { ReceivedMessageLifecycle } from "@truffle/dashboard-message-bus-client";
import type {
  Message,
  DashboardProviderMessage
} from "@truffle/dashboard-message-bus-common";
import { DashContext, reducer, initialState } from "src/contexts/DashContext";
import type { stateType } from "src/contexts/DashContext";
import {
  confirmMessage,
  rejectMessage,
  getChainNameByID
} from "src/utils/dash";

type DashProviderProps = {
  children: React.ReactNode;
};

function DashProvider({ children }: DashProviderProps): JSX.Element {
  const { isConnected } = useAccount();
  const provider: providers.Web3Provider = useProvider();
  const { chain } = useNetwork();
  const [state, dispatch] = useReducer(reducer, initialState);

  console.debug({ state });
  useDidUpdate(() => {
    async function init() {
      console.debug("Called init() in <DashProvider />");

      // Create message bus client
      const { host, port } = state;
      const client = new DashboardMessageBusClient({ host, port });
      await client.ready();
      dispatch({ type: "set-client", data: client });
      console.debug(`Connected to message bus at ws://${host}:${port}`);

      // Client subscribes to and handles messages
      const subscription = client.subscribe({});
      const messageHandler = (lifecycle: ReceivedMessageLifecycle<Message>) =>
        void dispatch({
          type: "handle-message",
          data: { lifecycle, provider }
        });
      subscription.on("message", messageHandler);

      // Clean up
      return () => {
        subscription.removeAllListeners();
        client.close();
      };
    }

    return init();
  }, []);

  useEffect(() => {
    dispatch({
      type: "set-notice",
      data: {
        show: !isConnected,
        type: "CONNECT"
      }
    });
  }, [isConnected]);

  useEffect(() => {
    const updateChangeInfo = () => {
      const data: stateType["chainInfo"] = { id: null, name: null };

      if (chain) {
        const { id, name } = chain;
        let updated;
        if (name === `Chain ${id}`) {
          updated = getChainNameByID(id);
        }
        data.id = id;
        data.name = updated ?? name;
      }

      dispatch({ type: "set-chain-info", data });
    };

    updateChangeInfo();
  }, [chain]);

  const ops = {
    userConfirmMessage: async (
      lifecycle: ReceivedMessageLifecycle<DashboardProviderMessage>
    ) => await confirmMessage(lifecycle, provider),
    userRejectMessage: (
      lifecycle: ReceivedMessageLifecycle<DashboardProviderMessage>
    ) => void rejectMessage(lifecycle, "USER")
  };

  return (
    <DashContext.Provider value={{ state, ops }}>
      {children}
    </DashContext.Provider>
  );
}

export default DashProvider;
