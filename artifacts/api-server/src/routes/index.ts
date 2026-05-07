import { Router, type IRouter } from "express";
import healthRouter from "./health";
import billsRouter from "./bills";

const router: IRouter = Router();

router.use(healthRouter);
router.use(billsRouter);

export default router;
