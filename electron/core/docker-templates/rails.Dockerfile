FROM ruby:3.2-slim
WORKDIR /app
COPY . .
EXPOSE 3000
CMD ["bundle","exec","rails","server","-b","0.0.0.0","-p","3000"]
