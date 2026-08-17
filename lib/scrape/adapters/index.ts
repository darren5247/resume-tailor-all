import type { Adapter } from "../types";
import { adpAdapter } from "./adp";
import { ashbyAdapter } from "./ashby";
import { bambooHrAdapter } from "./bamboohr";
import { breezyAdapter } from "./breezy";
import { comeetAdapter } from "./comeet";
import { doverAdapter } from "./dover";
import { gemAdapter } from "./gem";
import { greenhouseAdapter } from "./greenhouse";
import { hireologyAdapter } from "./hireology";
import { icimsAdapter } from "./icims";
import { jazzHrAdapter } from "./jazzhr";
import { jobdivaAdapter } from "./jobdiva";
import { jobviteAdapter } from "./jobvite";
import { joinAdapter } from "./join";
import { leverAdapter } from "./lever";
import { oracleCloudAdapter } from "./oraclecloud";
import { paycomAdapter } from "./paycom";
import { personioAdapter } from "./personio";
import { pinpointAdapter } from "./pinpoint";
import { recruiteeAdapter } from "./recruitee";
import { ripplingAdapter } from "./rippling";
import { smartRecruitersAdapter } from "./smartrecruiters";
import { successFactorsAdapter } from "./successfactors";
import { teamtailorAdapter } from "./teamtailor";
import { ultiproAdapter } from "./ultipro";
import { workableAdapter } from "./workable";
import { workdayAdapter } from "./workday";
import { zohoAdapter } from "./zoho";

export const ADAPTERS: Adapter[] = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  workableAdapter,
  smartRecruitersAdapter,
  workdayAdapter,
  bambooHrAdapter,
  recruiteeAdapter,
  comeetAdapter,
  personioAdapter,
  breezyAdapter,
  teamtailorAdapter,
  pinpointAdapter,
  jazzHrAdapter,
  ripplingAdapter,
  gemAdapter,
  jobviteAdapter,
  hireologyAdapter,
  joinAdapter,
  doverAdapter,
  icimsAdapter,
  oracleCloudAdapter,
  ultiproAdapter,
  zohoAdapter,
  adpAdapter,
  jobdivaAdapter,
  paycomAdapter,
  successFactorsAdapter,
];

export function detectAdapter(url: URL): Adapter | null {
  return ADAPTERS.find((adapter) => adapter.match(url)) ?? null;
}
