import { VideoCaptureService } from './VideoCaptureService';

export interface GoalEvent {
  timestamp: number;
  type: 'team_goal' | 'opponent_goal';
  gameTime: number;
  score: {
    left: number;
    right: number;
  };
}

export interface MatchSession {
  id: string;
  startTime: number;
  endTime?: number;
  playerName: string;
  playerId: string;
  gameMode: string;
  outcome?: 'victory' | 'defeat' | 'draw';
  finalScore?: {
    left: number;
    right: number;
  };
  goals: GoalEvent[];
  videoPath?: string;
  thumbnailPath?: string;
}

export class MatchSessionService {
  private static instance: MatchSessionService;
  private currentMatch: MatchSession | null = null;
  private videoCaptureService: VideoCaptureService;
  private matchStartTime: number = 0;
  
  private constructor() {
    this.videoCaptureService = VideoCaptureService.getInstance();
  }
  
  public static getInstance(): MatchSessionService {
    if (!MatchSessionService.instance) {
      MatchSessionService.instance = new MatchSessionService();
    }
    return MatchSessionService.instance;
  }
  
  public async startMatch(playerInfo: any, startRecording: boolean = true): Promise<void> {
    if (this.currentMatch) {
      console.warn('Match already in progress');
      return;
    }
    
    const matchId = `match_${Date.now()}`;
    this.matchStartTime = Date.now();
    
    this.currentMatch = {
      id: matchId,
      startTime: this.matchStartTime,
      playerName: playerInfo.player_name || 'Unknown',
      playerId: playerInfo.player_id || 'Unknown',
      gameMode: playerInfo.game_mode || 'Unknown',
      goals: []
    };
    
    console.log('Match started:', this.currentMatch);
    console.log('Player info received:', playerInfo);
    
    // Start video capture if requested
    if (startRecording) {
      try {
        console.log('Attempting to start auto-recording for match:', matchId);
        const videoPath = await this.videoCaptureService.startCapture(`RematchCoach/${matchId}`);
        this.currentMatch.videoPath = videoPath;
        console.log('Auto-recording started successfully, video path:', videoPath);
      } catch (error) {
        console.error('Failed to start auto-recording:', error);
        console.error('Error details:', {
          message: error.message,
          stack: error.stack
        });
        
        // Continue with match tracking even if video fails
        console.log('Continuing match tracking without video recording');
      }
    } else {
      console.log('Match started without recording (will be started later if user chooses)');
    }
  }
  
  public async endMatch(outcome: string, finalScore: any): Promise<MatchSession | null> {
    if (!this.currentMatch) {
      console.warn('No active match to end');
      return null;
    }
    
    // Check if match is already ended (idempotency check)
    if (this.currentMatch.endTime) {
      console.warn('Match already ended, ignoring duplicate end event');
      return null;
    }
    
    // Stop video capture
    try {
      await this.videoCaptureService.stopCapture();
    } catch (error) {
      console.error('Failed to stop video capture:', error);
    }
    
    // Update match data
    this.currentMatch.endTime = Date.now();
    this.currentMatch.outcome = outcome as 'victory' | 'defeat' | 'draw';
    
    if (finalScore) {
      this.currentMatch.finalScore = {
        left: parseInt(finalScore.left_score) || 0,
        right: parseInt(finalScore.right_score) || 0
      };
    }
    
    const completedMatch = { ...this.currentMatch };
    this.currentMatch = null;
    
    // Save match to storage
    await this.saveMatch(completedMatch);
    
    console.log('Match ended:', completedMatch);
    return completedMatch;
  }
  
  public addGoalEvent(type: 'team_goal' | 'opponent_goal', score?: any): void {
    if (!this.currentMatch) {
      console.warn('No active match to add goal event');
      return;
    }
    
    const currentTime = Date.now();
    const gameTime = currentTime - this.matchStartTime;
    
    const goalEvent: GoalEvent = {
      timestamp: currentTime,
      type: type,
      gameTime: gameTime,
      score: {
        left: score ? parseInt(score.left_score) || 0 : 0,
        right: score ? parseInt(score.right_score) || 0 : 0
      }
    };
    
    this.currentMatch.goals.push(goalEvent);
    console.log('Goal event added:', goalEvent);
    
    // Capture highlight for the goal
    this.captureGoalHighlight(goalEvent);
  }
  
  private async captureGoalHighlight(goalEvent: GoalEvent): Promise<void> {
    try {
      const highlightId = `goal_${goalEvent.timestamp}`;
      await this.videoCaptureService.captureHighlight(
        highlightId,
        goalEvent.gameTime,
        10000 // 10 second highlight
      );
    } catch (error) {
      console.error('Failed to capture goal highlight:', error);
    }
  }
  
  private async saveMatch(match: MatchSession): Promise<void> {
    return new Promise((resolve) => {
      // Get existing matches
      overwolf.profile.getCurrentUser((userResult) => {
        if (!userResult.success) {
          console.error('Failed to get current user');
          resolve();
          return;
        }
        
        const storageKey = 'rematch_matches';
        
        // For now, store in localStorage as a fallback
        try {
          let matches: MatchSession[] = [];
          const existing = localStorage.getItem(storageKey);
          if (existing) {
            matches = JSON.parse(existing);
          }
          
          // Add new match
          matches.unshift(match); // Add to beginning
          
          // Keep only last 100 matches
          if (matches.length > 100) {
            matches = matches.slice(0, 100);
          }
          
          // Save back to storage
          localStorage.setItem(storageKey, JSON.stringify(matches));
          console.log('Match saved to storage');
          resolve();
        } catch (error) {
          console.error('Failed to save match:', error);
          resolve();
        }
      });
    });
  }
  
  public async getMatches(): Promise<MatchSession[]> {
    return new Promise((resolve) => {
      try {
        const storageKey = 'rematch_matches';
        const existing = localStorage.getItem(storageKey);
        if (existing) {
          const matches = JSON.parse(existing);
          resolve(matches);
        } else {
          resolve([]);
        }
      } catch (error) {
        console.error('Failed to get matches:', error);
        resolve([]);
      }
    });
  }
  
  public getCurrentMatch(): MatchSession | null {
    return this.currentMatch;
  }
  
  public async startRecordingForCurrentMatch(): Promise<void> {
    if (!this.currentMatch) {
      console.warn('No active match to start recording for');
      return;
    }
    
    if (this.currentMatch.videoPath) {
      console.warn('Recording already started for this match');
      return;
    }
    
    try {
      console.log('Starting recording for existing match:', this.currentMatch.id);
      const videoPath = await this.videoCaptureService.startCapture(`RematchCoach/${this.currentMatch.id}`);
      this.currentMatch.videoPath = videoPath;
      console.log('Recording started successfully for existing match, video path:', videoPath);
    } catch (error) {
      console.error('Failed to start recording for existing match:', error);
    }
  }

  public async updateMatchVideoPath(matchId: string, filePath: string): Promise<void> {
    console.log(`Updating match ${matchId} with video path: ${filePath}`);
    
    // Convert file path to proper overwolf URL if needed
    let videoUrl = filePath;
    if (filePath && !filePath.startsWith('overwolf://')) {
      // Try to convert to overwolf media URL
      if (filePath.startsWith('C:\\') || filePath.includes('\\')) {
        // Windows file path - keep as is for now, the desktop window will handle conversion
        videoUrl = filePath;
      } else {
        // Relative path - convert to overwolf media URL
        videoUrl = `overwolf://media/videos/${filePath}`;
      }
    }
    
    console.log(`Converted video URL: ${videoUrl}`);
    
    // Update current match if it matches
    if (this.currentMatch && this.currentMatch.id === matchId) {
      this.currentMatch.videoPath = videoUrl;
      console.log('Updated current match video path');
    }
    
    // Update stored matches
    try {
      const matches = await this.getMatches();
      const matchIndex = matches.findIndex(m => m.id === matchId);
      
      if (matchIndex !== -1) {
        matches[matchIndex].videoPath = videoUrl;
        
        // Save back to storage
        const storageKey = 'rematch_matches';
        localStorage.setItem(storageKey, JSON.stringify(matches));
        console.log('Updated stored match video path in storage');
      } else {
        console.warn('Match not found in storage:', matchId);
      }
    } catch (error) {
      console.error('Failed to update match video path in storage:', error);
    }
  }
}