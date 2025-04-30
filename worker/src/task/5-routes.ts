import { namespaceWrapper, app, TASK_ID } from "@_koii/task-manager/namespace-wrapper";
import { getLeaderNode } from "../utils/leader";
import { task } from "./1-task";
import { submission } from "./2-submission";
import { audit } from "./3-audit";
import { taskRunner } from "@_koii/task-manager";
import { middleServerUrl, status } from "../utils/constant";

/**
 *
 * Define all your custom routes here
 *
 */

//Example route
export async function routes() {
  app.get("/value", async (_req, res) => {
    const value = await namespaceWrapper.storeGet("value");
    console.log("value", value);
    res.status(200).json({ value: value });
  });

  app.get("/leader/:roundNumber/:submitterPublicKey", async (req, res) => {
    const roundNumber = req.params.roundNumber;
    const submitterPublicKey = req.params.submitterPublicKey;
    const { isLeader, leaderNode } = await getLeaderNode({
      roundNumber: Number(roundNumber),
      submitterPublicKey: submitterPublicKey,
    });
    res.status(200).json({ isLeader: isLeader, leaderNode: leaderNode });
  });

  app.get("/task/:roundNumber", async (req, res) => {
    console.log("task endpoint called with round number: ", req.params.roundNumber);
    const roundNumber = req.params.roundNumber;
    const taskResult = await task(Number(roundNumber));
    res.status(200).json({ result: taskResult });
  });
  app.get("/audit/:roundNumber/:cid/:submitterPublicKey", async (req, res) => {
    const cid = req.params.cid;
    const roundNumber = req.params.roundNumber;
    const submitterPublicKey = req.params.submitterPublicKey;
    const auditResult = await audit(cid, Number(roundNumber), submitterPublicKey);
    res.status(200).json({ result: auditResult });
  });
  app.get("/submission/:roundNumber", async (req, res) => {
    const roundNumber = req.params.roundNumber;
    const submissionResult = await submission(Number(roundNumber));
    res.status(200).json({ result: submissionResult });
  });

  app.get("/submitDistribution/:roundNumber", async (req, res) => {
    const roundNumber = req.params.roundNumber;
    const submitDistributionResult = await taskRunner.submitDistributionList(Number(roundNumber));
    res.status(200).json({ result: submitDistributionResult });
  });

  app.post("/add-todo-pr", async (req, res) => {
    const signature = req.body.signature;
    const prUrl = req.body.prUrl;
    const roundNumber = Number(req.body.roundNumber);
    const success = req.body.success;
    const message = req.body.message;
    console.log("[TASK] req.body", req.body);
    try {
      if (success) {
        await namespaceWrapper.storeSet(`result-${roundNumber}`, status.ISSUE_SUCCESSFULLY_SUMMARIZED);
      } else {
        await namespaceWrapper.storeSet(`result-${roundNumber}`, status.ISSUE_SUMMARIZATION_FAILED);
        console.error("[TASK] Error summarizing repository:", message);
        return;
      }
      const uuid = await namespaceWrapper.storeGet(`uuid-${roundNumber}`);
      console.log("[TASK] uuid: ", uuid);
      if (!uuid) {
        throw new Error("No uuid found");
      }

      const currentRound = await namespaceWrapper.getRound();

      if (roundNumber !== currentRound) {
        throw new Error(`Invalid round number: ${roundNumber}. Current round: ${currentRound}.`);
      }

      const publicKey = await namespaceWrapper.getMainAccountPubkey();
      const stakingKeypair = await namespaceWrapper.getSubmitterAccount();
      if (!stakingKeypair) {
        throw new Error("No staking key found");
      }
      const stakingKey = stakingKeypair.publicKey.toBase58();
      const secretKey = stakingKeypair.secretKey;

      if (!publicKey) {
        throw new Error("No public key found");
      }

      const payload = await namespaceWrapper.verifySignature(signature, stakingKey);
      if (!payload) {
        throw new Error("Invalid signature");
      }
      console.log("[TASK] payload: ", payload);
      const data = payload.data;
      if (!data) {
        throw new Error("No signature data found");
      }
      const jsonData = JSON.parse(data);
      if (jsonData.taskId !== TASK_ID) {
        throw new Error(`Invalid task ID from signature: ${jsonData.taskId}. Actual task ID: ${TASK_ID}`);
      }
      if (jsonData.roundNumber !== currentRound) {
        throw new Error(
          `Invalid round number from signature: ${jsonData.roundNumber}. Current round: ${currentRound}.`,
        );
      }
      if (jsonData.uuid !== uuid) {
        throw new Error(`Invalid uuid from signature: ${jsonData.uuid}. Actual uuid: ${uuid}`);
      }
      const middleServerPayload = {
        taskId: jsonData.taskId,
        roundNumber,
        prUrl,
        stakingKey,
        publicKey,
        action: "add-todo-pr",
      };
      const middleServerSignature = await namespaceWrapper.payloadSigning(middleServerPayload, secretKey);
      const middleServerResponse = await fetch(`${middleServerUrl}/summarizer/worker/add-todo-pr`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ signature: middleServerSignature, stakingKey: stakingKey }),
      });

      console.log("[TASK] Add PR Response: ", middleServerResponse);

      if (middleServerResponse.status !== 200) {
        throw new Error(`Posting to middle server failed: ${middleServerResponse.statusText}`);
      }
      await namespaceWrapper.storeSet(`result-${roundNumber}`, status.SAVING_TODO_PR_SUCCEEDED);
      res.status(200).json({ result: "Successfully saved PR" });
    } catch (error) {
      console.error("[TASK] Error adding PR to summarizer todo:", error);
      await namespaceWrapper.storeSet(`result-${roundNumber}`, status.SAVING_TODO_PR_FAILED);
      res.status(400).json({ error: "Failed to save PR" });
    }
  });
}