const express = require("express");
const prisma = require("../../../lib/prisma");
const { authenticate } = require("../../../middleware/auth");
const router = express.Router();
router.get("/", authenticate, async (req, res, next) => {
  try {
    const chains = await prisma.chain.findMany({ where: { active: true } });
    res.json({ success: true, data: chains });
  } catch (err) { next(err); }
});
module.exports = router;
