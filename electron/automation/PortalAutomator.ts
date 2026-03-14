import { BaseAutomator } from './BaseAutomator';
import { PortalScraper } from './PortalScraper';
import { TeamsAutomator } from './TeamsAutomator';
import type { ClassSchedule } from './types';

export type { ClassSchedule };

export class PortalAutomator extends BaseAutomator {
  private isRunning: boolean = true;
  private onSchedule: (schedule: ClassSchedule[]) => void;
  private scraper: PortalScraper;
  private teams: TeamsAutomator;

  constructor(onLog: (msg: string) => void, onSchedule: (schedule: ClassSchedule[]) => void) {
    super(onLog);
    this.onSchedule = onSchedule;
    this.scraper = new PortalScraper(this.logger, this.retryHandler, this.navigation);
    this.teams = new TeamsAutomator(this.logger, this.retryHandler, this.navigation);
  }

  private parseTime(timeStr: string): Date {
    const match = timeStr.trim().match(/(\d{1,2})[.:](\d{2})\s*([AP]M)/i);
    if (!match) return new Date();
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (match[3].toUpperCase() === 'PM' && hours < 12) hours += 12;
    if (match[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
    const d = new Date();
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  public async run(username: string, password: string): Promise<boolean> {
    const category = 'ORCHESTRATOR';
    this.isRunning = true;
    
    try {
      await this.launchBrowser();
      if (!this.context) throw new Error('Failed to create browser context.');
      
      const page = await this.context.newPage();
      
      // 1. Login
      await this.scraper.login(page, username, password);

      // 2. Main Loop
      while (this.isRunning) {
        this.logger.info(category, 'Starting automation cycle...');
        
        // Ensure on dashboard
        if (!page.url().includes('/dashboard')) {
          await this.navigation.goto(page, 'https://sutech.univlms.com/dashboard/index');
        }

        await this.scraper.dismissPopups(page);
        
        const schedule = await this.scraper.scrapeSchedule(page);
        this.onSchedule(schedule);

        if (schedule.length === 0) {
          this.logger.info(category, 'No classes found. Waiting 5 minutes...');
          await new Promise(resolve => setTimeout(resolve, 300_000));
          continue;
        }

        // 3. Process Schedule
        const now = new Date();
        let activeClass: ClassSchedule | null = null;
        let nextClass: ClassSchedule | null = null;

        for (const cls of schedule) {
          const start = this.parseTime(cls.startTime);
          const end = this.parseTime(cls.endTime);
          const earlyJoin = new Date(start.getTime() - 10 * 60_000);

          if (now >= earlyJoin && now < end) {
            activeClass = cls;
            break;
          }
          if (now < earlyJoin && !nextClass) {
            nextClass = cls;
          }
        }

        if (activeClass) {
          this.logger.info(category, `Detected active class: ${activeClass.subject}`);
          const isTeams = activeClass.link.includes('teams.microsoft') || activeClass.link.includes('teams.live');
          
          if (isTeams) {
            await this.teams.joinMeeting(page, activeClass.link, username);
          } else {
            this.logger.info(category, 'Non-Teams link detected. Opening normally...');
            await this.navigation.goto(page, activeClass.link);
          }

          // Wait until end time
          await this.waitUntilEnd(page, activeClass);
          
          if (isTeams) {
            await this.teams.leaveMeeting(page);
          }
          
          this.logger.success(category, `Class "${activeClass.subject}" session completed.`);
        } else if (nextClass) {
          const start = this.parseTime(nextClass.startTime);
          const joinAt = new Date(start.getTime() - 10 * 60_000);
          const waitMs = joinAt.getTime() - Date.now();

          if (waitMs > 0 && waitMs < 4 * 60 * 60_000) {
            this.logger.info(category, `Next class "${nextClass.subject}" at ${nextClass.startTime}. Waiting ${Math.round(waitMs / 60_000)}m...`);
            await this.waitForNextClass(waitMs);
          } else {
            this.logger.info(category, 'Next class is too far away. Cycle ending.');
            break;
          }
        } else {
          this.logger.info(category, 'No more classes for today.');
          break;
        }
      }

      return true;
    } catch (error) {
      this.logger.error(category, 'Critical automation failure.', error);
      return false;
    }
  }

  private async waitUntilEnd(page: any, cls: ClassSchedule) {
    const end = this.parseTime(cls.endTime);
    while (Date.now() < end.getTime() && this.isRunning) {
        const remaining = end.getTime() - Date.now();
        const mins = Math.floor(remaining / 60_000);
        this.logger.info('ATTENDANCE', `Attending "${cls.subject}"... ${mins}m remaining.`);
        await new Promise(resolve => setTimeout(resolve, Math.min(60_000, remaining)));
    }
  }

  private async waitForNextClass(ms: number) {
    let remaining = ms;
    while (remaining > 0 && this.isRunning) {
        const tick = Math.min(60_000, remaining);
        await new Promise(resolve => setTimeout(resolve, tick));
        remaining -= tick;
        if (remaining > 0) {
            this.logger.info('WAIT', `${Math.round(remaining / 60_000)}m until next class join window.`);
        }
    }
  }

  public stop() {
    this.isRunning = false;
    this.close().catch(() => {});
  }
}
