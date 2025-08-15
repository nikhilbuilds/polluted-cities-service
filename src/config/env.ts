import dotenv from "dotenv";

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || "production",
  port: Number(process.env.PORT) || 3000,
  polluApiUsername: process.env.POLLU_API_USERNAME,
  polluApiPassword: process.env.POLLU_API_PASSWORD,
};
