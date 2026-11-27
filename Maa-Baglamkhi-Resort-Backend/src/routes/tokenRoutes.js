const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const { tokenRateLimiter } = require("../config/security");

const controller = require("../controller/tokenController");

// Token creation, items and closes.
// HAG-17: rate-limit external clients on the token write surface; exempted
// for local (dev/test) traffic so suites and localhost UI are unaffected.
router.use(authMiddleware);
router.use(tokenRateLimiter);

router.post("/create", controller.createToken);
router.get("/table/:table", controller.getTokenByTable);

router.post("/item", controller.addItem);
router.get("/items/:tokenId", controller.getItems);

router.put("/item", controller.updateItem);
router.delete("/item/:id", controller.deleteItem);
router.put("/close/:table", controller.closeTokenByTable);

module.exports = router;
