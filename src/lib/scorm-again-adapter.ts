import { Scorm12API, Scorm2004API } from 'scorm-again';

export interface SCORMAgainSettings {
  autocommit?: boolean;
  autocommitSeconds?: number;
  lmsCommitUrl?: string;
  logLevel?: number;
  mastery_override?: boolean;
  strict_errors?: boolean;
  userId?: string;
  courseId?: string;
}

export class SCORMAgainAdapter {
  private scorm12API: Scorm12API;
  private scorm2004API: Scorm2004API;
  private settings: SCORMAgainSettings;

  constructor(settings: SCORMAgainSettings = {}) {
    this.settings = {
      autocommit: true,
      autocommitSeconds: 10,
      logLevel: 4, // Debug level
      mastery_override: true,
      strict_errors: false,
      ...settings
    };

    // Initialize SCORM APIs
    this.scorm12API = new Scorm12API(this.settings);
    this.scorm2004API = new Scorm2004API(this.settings);

    // Set up initial student data
    this.initializeStudentData();
  }

  private initializeStudentData() {
    const studentId = this.settings.userId || 'student_001';
    const studentName = 'Student';

    // Set initial data for SCORM 1.2
    this.scorm12API.cmi.core.student_id = studentId;
    this.scorm12API.cmi.core.student_name = studentName;
    this.scorm12API.cmi.core.lesson_status = 'not attempted';
    this.scorm12API.cmi.core.entry = 'ab-initio';
    this.scorm12API.cmi.core.lesson_mode = 'normal';
    this.scorm12API.cmi.core.credit = 'credit';

    // Set initial data for SCORM 2004
    this.scorm2004API.cmi.learner_id = studentId;
    this.scorm2004API.cmi.learner_name = studentName;
    this.scorm2004API.cmi.completion_status = 'not attempted';
    this.scorm2004API.cmi.entry = 'ab-initio';
    this.scorm2004API.cmi.mode = 'normal';
    this.scorm2004API.cmi.credit = 'credit';
  }

  public getSCORM12API() {
    return this.scorm12API;
  }

  public getSCORM2004API() {
    return this.scorm2004API;
  }

  public makeAPIsGlobal() {
    // Make APIs globally available
    (window as unknown as Record<string, unknown>).API = this.scorm12API;
    (window as unknown as Record<string, unknown>).API_1484_11 = this.scorm2004API;

    // Also expose common SCORM API discovery functions
    (window as unknown as Record<string, unknown>).findAPI = (win: Window) => {
      let findAttempts = 0;
      while (!(win as unknown as Record<string, unknown>).API && win.parent && win.parent !== win) {
        findAttempts++;
        if (findAttempts > 7) {
          console.log("SCORM API not found after 7 attempts");
          return null;
        }
        win = win.parent;
      }
      return (win as unknown as Record<string, unknown>).API;
    };
    
    (window as unknown as Record<string, unknown>).getAPI = () => {
      return (window as unknown as Record<string, unknown>).API || (window as unknown as Record<string, unknown>).findAPI?.(window);
    };

    console.log('SCORM-Again APIs initialized and available globally');
  }

  public getStudentData() {
    return {
      id: this.scorm12API.cmi.core.student_id,
      name: this.scorm12API.cmi.core.student_name,
      lessonStatus: this.scorm12API.cmi.core.lesson_status,
      score: this.scorm12API.cmi.core.score.raw,
      sessionTime: this.scorm12API.cmi.core.session_time,
      totalTime: this.scorm12API.cmi.core.total_time,
      suspendData: this.scorm12API.cmi.suspend_data,
      lessonLocation: this.scorm12API.cmi.core.lesson_location
    };
  }

  public updateStudentData(data: Partial<{
    lessonStatus: string;
    score: string;
    sessionTime: string;
    suspendData: string;
    lessonLocation: string;
  }>) {
    if (data.lessonStatus) {
      this.scorm12API.cmi.core.lesson_status = data.lessonStatus;
      this.scorm2004API.cmi.completion_status = data.lessonStatus;
    }
    if (data.score) {
      this.scorm12API.cmi.core.score.raw = data.score;
      this.scorm2004API.cmi.score.raw = data.score;
    }
    if (data.sessionTime) {
      this.scorm12API.cmi.core.session_time = data.sessionTime;
      this.scorm2004API.cmi.session_time = data.sessionTime;
    }
    if (data.suspendData) {
      this.scorm12API.cmi.suspend_data = data.suspendData;
      this.scorm2004API.cmi.suspend_data = data.suspendData;
    }
    if (data.lessonLocation) {
      this.scorm12API.cmi.core.lesson_location = data.lessonLocation;
      this.scorm2004API.cmi.location = data.lessonLocation;
    }
  }

  public terminate() {
    this.scorm12API.terminate();
    this.scorm2004API.terminate();
  }

  public debug() {
    console.log('=== SCORM-Again Debug Info ===');
    console.log('SCORM 1.2 API:', this.scorm12API);
    console.log('SCORM 2004 API:', this.scorm2004API);
    console.log('Settings:', this.settings);
    console.log('Student Data:', this.getStudentData());
  }
}