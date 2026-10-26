const router = require("express").Router();
const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const zkController = require("../controller/zkController");

// Machine registration and pulls are admin-only; time checks and pulls are
// run against the device on the resort LAN.
router.use(authMiddleware, roleMiddleware(["admin"]));

router.get("/machines", zkController.listMachines);
router.post("/machines", zkController.createMachine);
router.put("/machines/:id", zkController.updateMachine);
router.delete("/machines/:id", zkController.deleteMachine);
router.post("/machines/:id/test-connection", zkController.testConnection);
router.post("/machines/:id/verify-time", zkController.verifyTime);
router.post("/machines/:id/sync", zkController.sync);
router.get("/machines/:id/pulls", zkController.pulls);

module.exports = router;
