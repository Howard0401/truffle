import { Paper, Code, createStyles } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import type { ReceivedMessageLifecycle } from "@truffle/dashboard-message-bus-client";
import type { DashboardProviderMessage } from "@truffle/dashboard-message-bus-common";
import Modal from "src/components/composed/Txs/Modal";

const useStyles = createStyles((_theme, _params, _getRef) => ({
  card: {
    padding: "50px 80px",
    ":hover": {
      cursor: "pointer"
    }
  },
  codeBlock: {
    width: 600,
    maxHeight: 160,
    wordWrap: "break-word",
    whiteSpace: "break-spaces",
    ":hover": {
      cursor: "default"
    }
  }
}));

type CardProps = {
  lifecycle: ReceivedMessageLifecycle<DashboardProviderMessage>;
};

function Card({ lifecycle }: CardProps): JSX.Element {
  const { classes } = useStyles();
  const [modalOpened, modalHandlers] = useDisclosure(false);
  const { method, params } = lifecycle.message.payload;

  const handleClick: React.MouseEventHandler<HTMLDivElement> = e => {
    if (e.target === e.currentTarget) {
      modalHandlers.open();
    }
  };

  return (
    <>
      <Modal
        lifecycle={lifecycle}
        opened={modalOpened}
        close={modalHandlers.close}
      />

      <Paper
        shadow="lg"
        radius="md"
        withBorder
        className={classes.card}
        onClick={handleClick}
      >
        <Code block={true} className={classes.codeBlock}>
          {method}
          <br />
          {JSON.stringify(params, null, 2)}
        </Code>
      </Paper>
    </>
  );
}

export default Card;