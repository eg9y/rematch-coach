declare namespace NodeJS {
  interface ProcessEnv {
    DEBUG_MODE: string;
    PROD_MODE: string;
  }
}

declare var process: {
  env: {
    DEBUG_MODE: string;
    PROD_MODE: string;
  }
}