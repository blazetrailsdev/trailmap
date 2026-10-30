import { ActionController } from "@blazetrails/actionpack";

type RouteHelper = (...args: unknown[]) => string;

export class ApplicationController extends ActionController.Base {
  // The route helpers controllers call, installed when config/routes.ts draws.
  declare rfcsPath: RouteHelper;
  declare rfcPath: RouteHelper;
  declare storyPath: RouteHelper;
  declare backlogPath: RouteHelper;
  declare searchPath: RouteHelper;
  declare sessionsTranscriptPath: RouteHelper;
  declare repoCodePath: RouteHelper;
  declare repoIssuesPath: RouteHelper;
  declare repoPullsPath: RouteHelper;
  declare repoActionsPath: RouteHelper;
  declare repoProjectsPath: RouteHelper;
  declare repoWikiPath: RouteHelper;
  declare repoPulsePath: RouteHelper;
  declare repoSettingsPath: RouteHelper;
}
