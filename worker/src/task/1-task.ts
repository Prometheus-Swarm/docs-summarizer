import { getOrcaClient } from "@_koii/task-manager/extensions";
import { namespaceWrapper, TASK_ID } from "@_koii/namespace-wrapper";
import "dotenv/config";
import { status, middleServerUrl } from "../utils/constant";
import dotenv from "dotenv";
import { checkAnthropicAPIKey, isValidAnthropicApiKey } from "../utils/anthropicCheck";
import { checkGitHub } from "../utils/githubCheck";
import { LogLevel } from "@_koii/namespace-wrapper/dist/types";
import { actionMessage } from "../utils/constant";
import { errorMessage } from "../utils/constant";
import { v4 as uuidv4 } from "uuid";
dotenv.config();

export async function task(roundNumber: number): Promise<void> {
  /**
   * Run your task and store the proofs to be submitted for auditing
   * It is expected you will store the proofs in your container
   * The submission of the proofs is done in the submission function
   */
  // FORCE TO PAUSE 30 SECONDS
  // No submission on Round 0 so no need to trigger fetch audit result before round 3
  // Changed from 3 to 4 to have more time
  if (roundNumber >= 4) {
    const triggerFetchAuditResult = await fetch(`${middleServerUrl}/summarizer/worker/update-audit-result`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ taskId: TASK_ID, round: roundNumber - 4 }),
    });
    console.log(
      `[TASK] Trigger fetch audit result for round ${roundNumber - 3}. Result is ${triggerFetchAuditResult.status}.`,
    );
  }
  console.log(`[TASK] EXECUTE TASK FOR ROUND ${roundNumber}`);
  try {
    const orcaClient = await getOrcaClient();
    // check if the env variable is valid
    if (!process.env.ANTHROPIC_API_KEY) {
      await namespaceWrapper.logMessage(
        LogLevel.Error,
        errorMessage.ANTHROPIC_API_KEY_INVALID,
        actionMessage.ANTHROPIC_API_KEY_INVALID,
      );
      await namespaceWrapper.storeSet(`result-${roundNumber}`, status.ANTHROPIC_API_KEY_INVALID);
      return;
    }
    if (!isValidAnthropicApiKey(process.env.ANTHROPIC_API_KEY!)) {
      await namespaceWrapper.logMessage(
        LogLevel.Error,
        errorMessage.ANTHROPIC_API_KEY_INVALID,
        actionMessage.ANTHROPIC_API_KEY_INVALID,
      );
      await namespaceWrapper.storeSet(`result-${roundNumber}`, status.ANTHROPIC_API_KEY_INVALID);
      return;
    }
    const isAnthropicAPIKeyValid = await checkAnthropicAPIKey(process.env.ANTHROPIC_API_KEY!);
    if (!isAnthropicAPIKeyValid) {
      await namespaceWrapper.logMessage(
        LogLevel.Error,
        errorMessage.ANTHROPIC_API_KEY_NO_CREDIT,
        actionMessage.ANTHROPIC_API_KEY_NO_CREDIT,
      );
      await namespaceWrapper.storeSet(`result-${roundNumber}`, status.ANTHROPIC_API_KEY_NO_CREDIT);
      return;
    }
    if (!process.env.GITHUB_USERNAME || !process.env.GITHUB_TOKEN) {
      await namespaceWrapper.logMessage(
        LogLevel.Error,
        errorMessage.GITHUB_CHECK_FAILED,
        actionMessage.GITHUB_CHECK_FAILED,
      );
      await namespaceWrapper.storeSet(`result-${roundNumber}`, status.GITHUB_CHECK_FAILED);
      return;
    }
    const isGitHubValid = await checkGitHub(process.env.GITHUB_USERNAME!, process.env.GITHUB_TOKEN!);
    if (!isGitHubValid) {
      await namespaceWrapper.logMessage(
        LogLevel.Error,
        errorMessage.GITHUB_CHECK_FAILED,
        actionMessage.GITHUB_CHECK_FAILED,
      );
      await namespaceWrapper.storeSet(`result-${roundNumber}`, status.GITHUB_CHECK_FAILED);
      return;
    }
    if (!orcaClient) {
      await namespaceWrapper.logMessage(LogLevel.Error, errorMessage.NO_ORCA_CLIENT, actionMessage.NO_ORCA_CLIENT);
      await namespaceWrapper.storeSet(`result-${roundNumber}`, status.NO_ORCA_CLIENT);
      return;
    }

    const stakingKeypair = await namespaceWrapper.getSubmitterAccount();
    if (!stakingKeypair) {
      throw new Error("No staking keypair found");
    }
    const stakingKey = stakingKeypair.publicKey.toBase58();
    const pubKey = await namespaceWrapper.getMainAccountPubkey();
    if (!pubKey) {
      throw new Error("No public key found");
    }

    /****************** All these issues need to be generate a markdown file ******************/

    const signature = await namespaceWrapper.payloadSigning(
      {
        taskId: TASK_ID,
        roundNumber: roundNumber,
        action: "fetch-todo",
        githubUsername: stakingKey,
        stakingKey: stakingKey,
      },
      stakingKeypair.secretKey,
    );

    // const initializedDocumentSummarizeIssues = await getInitializedDocumentSummarizeIssues(existingIssues);

    console.log(`[TASK] Making Request to Middle Server with taskId: ${TASK_ID} and round: ${roundNumber}`);
    const requiredWorkResponse = await fetch(`${middleServerUrl}/summarizer/worker/fetch-todo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ signature: signature, stakingKey: stakingKey }),
    });
    // check if the response is 200
    if (requiredWorkResponse.status !== 200) {
      await namespaceWrapper.storeSet(`result-${roundNumber}`, status.NO_ISSUES_PENDING_TO_BE_SUMMARIZED);
      return;
    }
    const requiredWorkResponseData = await requiredWorkResponse.json();
    console.log("[TASK] requiredWorkResponseData: ", requiredWorkResponseData);
    const uuid = uuidv4();
    await namespaceWrapper.storeSet(`uuid-${roundNumber}`, uuid);

    const podcallPayload = {
      taskId: TASK_ID,
      roundNumber,
      uuid,
    };

    const podCallSignature = await namespaceWrapper.payloadSigning(podcallPayload, stakingKeypair.secretKey);

    const jsonBody = {
      task_id: TASK_ID,
      round_number: roundNumber,
      repo_url: `https://github.com/${requiredWorkResponseData.data.repo_owner}/${requiredWorkResponseData.data.repo_name}`,
      podcall_signature: podCallSignature,
    };
    console.log("[TASK] jsonBody: ", jsonBody);
    try {
      const repoSummaryResponse = await orcaClient.podCall(`worker-task/${roundNumber}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(jsonBody),
      });
      console.log("[TASK] repoSummaryResponse: ", repoSummaryResponse);
      if (repoSummaryResponse.status !== 200) {
        await namespaceWrapper.storeSet(`result-${roundNumber}`, status.ISSUE_SUMMARIZATION_FAILED);
      }
    } catch (error) {
      await namespaceWrapper.storeSet(`result-${roundNumber}`, status.ISSUE_SUMMARIZATION_FAILED);
      console.error("[TASK] EXECUTE TASK ERROR:", error);
    }
  } catch (error) {
    await namespaceWrapper.storeSet(`result-${roundNumber}`, status.UNKNOWN_ERROR);
    console.error("[TASK] EXECUTE TASK ERROR:", error);
  }
}