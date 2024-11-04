import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// Define the validation logic
@ValidatorConstraint({ async: false })
export class IsWalletAddressConstraint implements ValidatorConstraintInterface {
  validate(address: string) {
    // Check if the address matches the typical pattern for an Ethereum wallet
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  defaultMessage() {
    return 'The value ($value) is not a valid wallet address';
  }
}

// Create the custom decorator
export function IsWalletAddress(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isWalletAddress',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: new IsWalletAddressConstraint(),
    });
  };
}
