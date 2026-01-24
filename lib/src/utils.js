import config from "config";
import winston from "winston";
const logger = winston.createLogger({
    format: winston.format.prettyPrint(),
    transports: [new winston.transports.Console()],
});
export const getLogger = () => logger;
const botConfig = config.get("bot");
export const getConfig = () => botConfig;
export const getUsername = () => botConfig.username;
export const configValueToFloat = (value) => {
    return typeof value == "number" ? value : parseFloat(value);
};
export const configValueToInt = (value) => {
    return typeof value == "number" ? value : parseInt(value);
};
//# sourceMappingURL=utils.js.map