import { Router, type IRouter } from "express";
import healthRouter from "./health";
import gtfsRouter from "./gtfs";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/gtfs", gtfsRouter);

export default router;
