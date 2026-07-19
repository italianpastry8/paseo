import type pino from "pino";
import { defaultHostToolsPaths, type HostToolsPaths } from "./paths.js";
import { HostQuotaService } from "./quota-service.js";
import { HostRolesService } from "./roles-service.js";
import { defaultSkillRoots, type SkillRootSpec } from "./skill-scanner.js";
import { HostSkillsService } from "./skills-service.js";

/**
 * host-tools-registry.ts — daemon-level singleton owner of the three host
 * tools services. Services are constructed lazily and live for the daemon's
 * lifetime: sessions attach/detach listeners, but disconnecting a session
 * never stops the file watchers (task 5.2).
 */

export interface HostToolsFeatures {
  quota: boolean;
  roles: boolean;
  skills: boolean;
}

export interface HostToolsRegistryOptions {
  logger: pino.Logger;
  paths?: HostToolsPaths;
  skillRoots?: SkillRootSpec[];
}

export class HostToolsRegistry {
  private readonly logger: pino.Logger;
  private readonly paths: HostToolsPaths;
  private readonly skillRoots: SkillRootSpec[];

  private quotaService: HostQuotaService | null = null;
  private rolesService: HostRolesService | null = null;
  private skillsService: HostSkillsService | null = null;

  constructor(options: HostToolsRegistryOptions) {
    this.logger = options.logger;
    this.paths = options.paths ?? defaultHostToolsPaths();
    this.skillRoots = options.skillRoots ?? defaultSkillRoots();
  }

  quota(): HostQuotaService {
    if (!this.quotaService) {
      this.quotaService = new HostQuotaService({
        exportPath: this.paths.quotaExportPath,
        cliPath: this.paths.quotaCliPath,
        configPath: this.paths.quotaConfigPath,
        logger: this.logger.child({ tool: "quota" }),
      });
    }
    return this.quotaService;
  }

  roles(): HostRolesService {
    if (!this.rolesService) {
      this.rolesService = new HostRolesService({
        configPath: this.paths.omoConfigPath,
        opencodeCommand: this.paths.opencodeCommand,
        logger: this.logger.child({ tool: "roles" }),
      });
    }
    return this.rolesService;
  }

  skills(): HostSkillsService {
    if (!this.skillsService) {
      this.skillsService = new HostSkillsService({
        roots: this.skillRoots,
        statePath: this.paths.skillManagerStatePath,
        logger: this.logger.child({ tool: "skills" }),
      });
    }
    return this.skillsService;
  }

  features(): HostToolsFeatures {
    return {
      quota: this.quota().isAvailable(),
      roles: this.roles().isAvailable(),
      skills: this.skills().isAvailable(),
    };
  }
}
