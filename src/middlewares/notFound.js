function notFoundHandler(req, res) {
  res.status(404).json({ message: 'Resource not found' });
}

module.exports = notFoundHandler;
