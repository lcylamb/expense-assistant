import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * 登录入参。
 *
 * 只校验「形状」，不校验「密码强度」—— 登录端点不该reject一个格式奇怪的密码，
 * 那只会告诉对方「你的密码不是我们要求的格式」，而正确的回答永远是
 * 同一句「用户名或密码不对」。
 *
 * 长度上限用来挡超长输入：scrypt 对任意长度输入都能跑，但没必要让一个
 * 1MB 的 body 换走一次 40ms 的 CPU。
 */
export class LoginDto {
  @IsString()
  @MinLength(1, { message: '请输入用户名' })
  @MaxLength(64)
  username!: string;

  @IsString()
  @MinLength(1, { message: '请输入密码' })
  @MaxLength(128)
  password!: string;
}
