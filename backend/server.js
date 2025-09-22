// Delete a message by ID (for simplicity: deletes only the sender's own message)
app.delete("/api/message/:id/:user", async (req, res) => {
  const { id, user } = req.params;
  try {
    const message = await Chat.findById(id);
    if (!message) return res.status(404).json({ error: "Message not found" });
    if (message.sender !== user) return res.status(403).json({ error: "Cannot delete others' messages" });

    await Chat.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete message" });
  }
});
