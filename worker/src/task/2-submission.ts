import { storeFile } from "../utils/ipfs";
import { getOrcaClient } from "@_koii/task-manager/extensions";
import { namespaceWrapper, TASK_ID } from "@_koii/namespace-wrapper";
import { middleServerUrl, status } from "../utils/constant";
import { preRunCheck } from "../utils/check/checks";
export async function submission(roundNumber: number) : Promise<string | void> {
  /**
   * Retrieve the task proofs from your container and submit for auditing
   * Must return a string of max 512 bytes to be submitted on chain
   * The default implementation handles uploading the proofs to IPFS
   * and returning the CID
   */
  if(!await preRunCheck(roundNumber.toString())){
    return;
  }
  const stakingKeypair = await namespaceWrapper.getSubmitterAccount();
  const pubKey = await namespaceWrapper.getMainAccountPubkey();
  if (!stakingKeypair || !pubKey) {
    console.error("[SUBMISSION] No staking keypair or public key found");
    throw new Error("No staking keypair or public key found");
  }
  const stakingKey = stakingKeypair.publicKey.toBase58();
  
  const secretKey = stakingKeypair.secretKey;
  console.log(`[SUBMISSION] Starting submission process for round ${roundNumber}`);

  try {
    console.log("[SUBMISSION] Initializing Orca client...");
    const orcaClient = await getOrcaClient();
    if (!orcaClient) {
      console.error("[SUBMISSION] Failed to initialize Orca client");
      return;
    }
    console.log("[SUBMISSION] Orca client initialized successfully");
    console.log(`[SUBMISSION] Fetching task result for round ${roundNumber}...`);
    const shouldMakeSubmission = await namespaceWrapper.storeGet(`shouldMakeSubmission`);
    if (!shouldMakeSubmission || shouldMakeSubmission !== "true") {
      return;
    }
   
    const cid = await makeSubmission({orcaClient, roundNumber, stakingKey, publicKey: pubKey, secretKey});
    return cid || void 0;
  } catch (error) {
    console.error("[SUBMISSION] Error during submission process:", error);
    throw error;
  }
}

async function makeSubmission({orcaClient, roundNumber, stakingKey, publicKey, secretKey}: {orcaClient: any, roundNumber: number, stakingKey: string, publicKey: string, secretKey: Uint8Array<ArrayBufferLike>}) {
  const swarmBountyId = await namespaceWrapper.storeGet(`swarmBountyId`);
  if (!swarmBountyId) {
    console.log("[SUBMISSION] No swarm bounty id found for this round");
    return;
  }
  console.log(`[SUBMISSION] Fetching submission data for round ${roundNumber}. and submission roundnumber ${swarmBountyId}`);
  const result = await orcaClient.podCall(`submission/${swarmBountyId}`);
  let submission;
  console.log("[SUBMISSION] Submission result:", result);
  console.log("[SUBMISSION] Submission result data:", result.data);

  if (!result || result.data === "No submission") {
    console.log("[SUBMISSION] No existing submission found");
    return;
  } else {
    // Add extra error handling for https://koii-workspace.slack.com/archives/C0886H01JM8/p1746137232538419
    if (typeof result.data === 'object' && 'data' in result.data) {
      console.log("[SUBMISSION] Submission result data is an object with 'data' property");
      submission = result.data.data;
    } else {
      console.log("[SUBMISSION] Submission result data is not an object with 'data' property");
      submission = result.data;
    }
  }

  if (!submission.prUrl) {
    console.error("[SUBMISSION] Missing PR URL in submission");
    throw new Error("Submission is missing PR URL");
  }
      const middleServerPayload = {
        taskId: TASK_ID,
        swarmBountyId,
        prUrl: submission.prUrl,
        stakingKey,
        publicKey,
        action: "add-round-number",
      };
      
      const middleServerSignature = await namespaceWrapper.payloadSigning(middleServerPayload, secretKey);
      const middleServerResponse = await fetch(`${middleServerUrl}/summarizer/worker/add-round-number`, {
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
      const signature = await namespaceWrapper.payloadSigning(
        {
          taskId: TASK_ID,
          roundNumber,
          stakingKey,
          pubKey:publicKey,
          // action: "audit",
          ...submission,
        },
        secretKey,
      );
      console.log("[SUBMISSION] Payload signed successfully");
  
      console.log("[SUBMISSION] Storing submission on IPFS...");
      const cid = await storeFile({ signature }, "submission.json");
      console.log("[SUBMISSION] Submission stored successfully. CID:", cid);
      // If done please set the shouldMakeSubmission to false
      await namespaceWrapper.storeSet(`shouldMakeSubmission`, "false");
      await namespaceWrapper.storeSet(`swarmBountyId`, "");
      return cid;
}